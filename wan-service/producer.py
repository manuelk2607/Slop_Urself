"""Controlled inference core, NOT an exposed or qualified production endpoint.

No downloads or GPU allocation on import. Only locally verified safetensors may
be loaded. The caller must provide qualified moderation and personal ZeroGPU
authorization; this module does not replace either of those application gates.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import unicodedata

ROOT = Path(__file__).resolve().parent
BOUNDED_SIZES = ((832, 624), (624, 832), (640, 640))


def manifest(path=ROOT / "model-lock.json"):
    lock = json.loads(Path(path).read_text())
    if lock.get("schema") != 1 or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", lock.get("id", "")):
        raise ValueError("Invalid model identity")
    if any(part in (".", "..") for part in lock["id"].split("/")):
        raise ValueError("Invalid model path")
    if not re.fullmatch(r"[a-f0-9]{40}", lock.get("revision", "")):
        raise ValueError("An immutable model revision is required")
    files, names = lock.get("files"), set()
    if not isinstance(files, list) or not 1 <= len(files) <= 128:
        raise ValueError("Missing bounded artifact manifest")
    for entry in files:
        name = entry.get("path", "")
        parts = PurePosixPath(name).parts
        if not name or not parts or name.startswith("/") or "\\" in name or any(p in (".", "..") for p in name.split("/")):
            raise ValueError("Unsafe artifact path")
        if name in names or not name.endswith((".json", ".safetensors")):
            raise ValueError("Duplicate or executable model artifact")
        names.add(name)
        if type(entry.get("bytes")) is not int or entry["bytes"] <= 0 or not re.fullmatch(r"[a-f0-9]{64}", entry.get("sha256", "")):
            raise ValueError("Missing artifact hash or size")
    if (lock.get("pipeline"), lock.get("scheduler"), lock.get("flowShift"), lock.get("boundaryRatio"), lock.get("fps"), lock.get("frames"), lock.get("steps"), lock.get("guidanceScale")) != (
            "WanImageToVideoPipeline", "UniPCMultistepScheduler", 3, 0.9, 16, 81, [4, 8], 1):
        raise ValueError("Unreviewed recipe change")
    return lock


def verify_directory(directory, lock):
    root = Path(directory).resolve(strict=True)
    for entry in lock["files"]:
        path = root / entry["path"]
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root and root in parent.parents):
            raise ValueError("Model symlinks are not accepted")
        if not path.is_file() or not path.resolve().is_relative_to(root) or path.stat().st_size != entry["bytes"]:
            raise ValueError("Missing or truncated model artifact")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != entry["sha256"]:
            raise ValueError("Model artifact drift")
    # Only fixed built-in component classes. No custom pipelines or remote code.
    index = json.loads((root / "model_index.json").read_text())
    allowed = {"scheduler": ["diffusers", "UniPCMultistepScheduler"],
               "text_encoder": ["transformers", "UMT5EncoderModel"], "tokenizer": ["transformers", "T5TokenizerFast"],
               "transformer": ["diffusers", "WanTransformer3DModel"], "transformer_2": ["diffusers", "WanTransformer3DModel"],
               "vae": ["diffusers", "AutoencoderKLWan"], "image_encoder": [None, None], "image_processor": [None, None]}
    if index.get("_class_name") != lock["pipeline"] or any(index.get(k) != v for k, v in allowed.items()):
        raise ValueError("Unreviewed pipeline component")
    if index.get("boundary_ratio") != lock["boundaryRatio"] or index.get("expand_timesteps") is not False:
        raise ValueError("Unreviewed expert schedule")
    scheduler = json.loads((root / "scheduler/scheduler_config.json").read_text())
    if scheduler.get("_class_name") != lock["scheduler"] or scheduler.get("flow_shift") != lock["flowShift"]:
        raise ValueError("Scheduler drift")
    return root


def parameters(prompt, width, height, seed, steps, duration_seconds=5):
    if not isinstance(prompt, str) or not 1 <= len(prompt) <= 512 or any(unicodedata.category(c) in ("Cc", "Cf") for c in prompt):
        raise ValueError("Invalid exact moderated prompt")
    if any(type(v) is not int for v in (width, height, seed, steps)) or not 0 <= seed < 2 ** 31:
        raise ValueError("Explicit integer dimensions, seed and steps required")
    if steps not in (4, 8) or duration_seconds != 5:
        raise ValueError("Unreviewed generation mode")
    if (width, height) not in BOUNDED_SIZES:
        raise ValueError("Image outside bounded inference profile")
    return {"prompt": prompt, "height": height, "width": width, "num_frames": 81,
            "num_inference_steps": steps, "guidance_scale": 1.0, "guidance_scale_2": 1.0}


def load_pipeline(directory):
    if any(os.environ.get(key) for key in ("REPO_ID", "MODEL_ID", "LORA_MODELS")):
        raise ValueError("Environment cannot select a different model or adapter")
    lock = manifest()
    root = verify_directory(directory, lock)  # Before importing/loading native code.
    import torch
    from diffusers import WanImageToVideoPipeline
    from torchao.quantization import quantize_, Float8DynamicActivationFloat8WeightConfig, Int8WeightOnlyConfig
    pipe = WanImageToVideoPipeline.from_pretrained(str(root), local_files_only=True,
                                                 use_safetensors=True, torch_dtype=torch.bfloat16, token=False)
    # Same explicit quantization recipe as the inspected prototype, without
    # unpinned AOTI repositories, arbitrary LoRAs, installers or scheduler selectors.
    pipe.to("cuda")
    quantize_(pipe.text_encoder, Int8WeightOnlyConfig())
    quantize_(pipe.transformer, Float8DynamicActivationFloat8WeightConfig())
    quantize_(pipe.transformer_2, Float8DynamicActivationFloat8WeightConfig())
    pipe.vae.enable_tiling()
    return pipe


def infer(pipe, image, prompt, seed, steps, negative_prompt):
    args = parameters(prompt, *image.size, seed, steps)
    if not isinstance(negative_prompt, str) or len(negative_prompt) > 512:
        raise ValueError("Invalid negative prompt")
    import torch
    # No default seed, model selection, interpolation or prompt rewriting.
    result = pipe(image=image, negative_prompt=negative_prompt, output_type="pil",
                  generator=torch.Generator(device="cuda").manual_seed(seed), **args).frames[0]
    if len(result) != 81:
        raise ValueError("Incomplete generated video")
    return result


def write_video(frames, path):
    if len(frames) != 81 or Path(path).suffix != ".mp4":
        raise ValueError("Expected exactly 81 frames and MP4 output")
    import imageio_ffmpeg
    width, height = frames[0].size
    parameters("Validate output dimensions", width, height, 0, 8)
    if frames[0].mode != "RGB":
        raise ValueError("Expected RGB frames")
    writer = imageio_ffmpeg.write_frames(str(path), (width, height), fps=16, codec="libx264",
        pix_fmt_in="rgb24", pix_fmt_out="yuv420p", output_params=["-movflags", "+faststart"])
    try:
        writer.send(None)
        for frame in frames:
            if frame.size != (width, height) or frame.mode != "RGB":
                raise ValueError("Inconsistent generated frame")
            data = frame.tobytes()
            if len(data) != width * height * 3:
                raise ValueError("Incomplete RGB data")
            writer.send(data)
    finally:
        writer.close()


if __name__ == "__main__":
    # Default command is deliberately CPU/read-only: no imports of torch,
    # installation, weight downloads, GPU invocation or approval changes.
    lock = manifest()
    print(json.dumps({"id": lock["id"], "revision": lock["revision"],
        "requiredArtifactBytes": sum(e["bytes"] for e in lock["files"]),
        "declaredLicense": lock["declaredLicense"], "qualified": False, "gpuCalls": 0}))
