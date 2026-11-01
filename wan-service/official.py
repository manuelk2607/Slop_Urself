"""Explicit official Wan 5B recipe. No hub access, torch or GPU on import."""
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from producer import BOUNDED_SIZES

ROOT = Path(__file__).resolve().parent
MODEL_ID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
MODEL_REVISION = "b8fff7315c768468a5333511427288870b2e9635"


def manifest(path=ROOT / "official-model-lock.json"):
    lock = json.loads(Path(path).read_text())
    if (lock.get("schema"), lock.get("id"), lock.get("revision"), lock.get("declaredLicense"),
            lock.get("pipeline"), lock.get("scheduler"), lock.get("flowShift"), lock.get("frames"),
            lock.get("fps"), lock.get("steps"), lock.get("guidanceScale"), lock.get("gpuSize"), lock.get("maxGpuSeconds")) != (
            1, MODEL_ID, MODEL_REVISION, "apache-2.0", "WanPipeline", "UniPCMultistepScheduler", 5, 121, 24, 50, 5, "large", 120):
        raise ValueError("Official recipe drift")
    files, names = lock.get("files"), set()
    if not isinstance(files, list) or len(files) != 20:
        raise ValueError("Incomplete official manifest")
    for item in files:
        name = item.get("path", "")
        if not isinstance(name, str) or not name or PurePosixPath(name).is_absolute() or "\\" in name or any(p in ("", ".", "..") for p in name.split("/")):
            raise ValueError("Unsafe artifact path")
        if name in names or not name.endswith((".json", ".safetensors", ".model")):
            raise ValueError("Unreviewed artifact")
        names.add(name)
        if type(item.get("bytes")) is not int or item["bytes"] <= 0 or not re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", "")):
            raise ValueError("Missing hash or size")
    return lock


def verify_directory(directory, lock):
    candidate = Path(directory)
    if candidate.is_symlink():
        raise ValueError("Symlink snapshot root")
    root = candidate.resolve(strict=True)
    allowed={entry['path'] for entry in lock['files']}
    for item in root.rglob('*'):
        relative=item.relative_to(root).as_posix()
        if item.is_symlink():
            raise ValueError('Symlink snapshot entry')
        # Hub download bookkeeping is not a loader input. Every possible model
        # or component file outside that directory must be in the exact lock.
        if item.is_file() and relative not in allowed and not relative.startswith('.cache/huggingface/'):
            raise ValueError('Unlisted snapshot file could override a locked component')
    for entry in lock["files"]:
        file = root / entry["path"]
        current = file
        while current != root:
            if current.is_symlink():
                raise ValueError("Symlink artifact")
            current = current.parent
        if not file.is_file() or file.stat().st_size != entry["bytes"]:
            raise ValueError("Missing or truncated artifact")
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != entry["sha256"]:
            raise ValueError("Artifact drift")
    index = json.loads((root / "model_index.json").read_text())
    components = {"scheduler": ["diffusers", "UniPCMultistepScheduler"], "text_encoder": ["transformers", "UMT5EncoderModel"],
        "tokenizer": ["transformers", "T5TokenizerFast"], "transformer": ["diffusers", "WanTransformer3DModel"],
        "transformer_2": [None, None], "vae": ["diffusers", "AutoencoderKLWan"]}
    if index.get("_class_name") != "WanPipeline" or index.get("expand_timesteps") is not True or index.get("boundary_ratio") is not None or any(index.get(k) != v for k,v in components.items()):
        raise ValueError("Pipeline component drift")
    scheduler = json.loads((root / "scheduler/scheduler_config.json").read_text())
    if scheduler.get("_class_name") != "UniPCMultistepScheduler" or scheduler.get("flow_shift") != 5:
        raise ValueError("Scheduler drift")
    return root


def parameters(prompt, width, height, seed, steps=50, duration_seconds=5):
    import unicodedata
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 512 or any(unicodedata.category(c) in ("Cc", "Cf") for c in prompt):
        raise ValueError("Invalid exact prompt")
    if any(type(v) is not int for v in (width, height, seed, steps)) or not 0 <= seed < 2**31 or (width, height) not in BOUNDED_SIZES or steps != 50 or type(duration_seconds) not in (int,float) or duration_seconds != 5:
        raise ValueError("Unreviewed generation parameters")
    return {"prompt": prompt, "width": width, "height": height, "num_frames": 121, "num_inference_steps": 50, "guidance_scale": 5.0}


def load_pipeline(directory):
    import os
    if any(os.environ.get(k) for k in ("REPO_ID", "MODEL_ID", "LORA_MODELS")):
        raise ValueError("Runtime model selection forbidden")
    lock = manifest()
    root = verify_directory(directory, lock)
    import torch
    from diffusers import WanPipeline
    pipe = WanPipeline.from_pretrained(str(root), local_files_only=True, use_safetensors=True,
        torch_dtype=torch.bfloat16, low_cpu_mem_usage=True, token=False)
    # ZeroGPU CUDA emulation at startup; no dynamically fetched AOTI/LoRA code.
    pipe.to("cuda")
    pipe.vae.enable_tiling()
    return pipe


def infer(pipe, image, prompt, seed, steps, duration_seconds):
    args = parameters(prompt, *image.size, seed, steps, duration_seconds)
    import torch
    frames = pipe(image=image, output_type="pil", generator=torch.Generator(device="cuda").manual_seed(seed), **args).frames[0]
    if len(frames) != 121:
        raise ValueError("Incomplete generated video")
    return frames
