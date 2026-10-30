import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from producer import manifest, verify_directory, parameters, load_pipeline, BOUNDED_SIZES
import re


class ProducerTests(unittest.TestCase):
    def test_actual_lock_is_immutable_and_complete(self):
        lock = manifest()
        self.assertEqual(len(lock["files"]), 22)
        self.assertGreater(sum(f["bytes"] for f in lock["files"]), 68_000_000_000)
        self.assertIsNone(lock["declaredLicense"])  # Not silently approved.

    def test_parameter_contract_has_no_random_or_mutable_defaults(self):
        args = parameters("The red cube rotates.", 832, 624, 123, 8)
        self.assertEqual(args["num_frames"], 81)
        self.assertEqual(args["num_inference_steps"], 8)
        self.assertEqual(args["guidance_scale_2"], 1)
        for width, height, seed, steps, duration in [(832, 832, 1, 8, 5), (703, 512, 1, 8, 5),
                (832, 624, -1, 8, 5), (832, 624, 1, 50, 5), (832, 624, 1, True, 5), (832, 624, 1, 8, 2)]:
            with self.assertRaises(ValueError):
                parameters("cube rotates", width, height, seed, steps, duration)
        for prompt in ("", "x" * 513, "wave\u200b"):
            with self.assertRaises(ValueError):
                parameters(prompt, 832, 624, 1, 4)

    def test_app_image_profile_cannot_drift_silently(self):
        source = (Path(__file__).resolve().parent.parent / "src/ai/images.ts").read_text()
        match = re.search(r"BOUNDED_IMAGE_SIZES\s*=\s*(\[.*?\])\s+as const", source, re.S)
        self.assertIsNotNone(match)
        self.assertEqual(json.loads(match[1]), [list(size) for size in BOUNDED_SIZES])
        for width, height in BOUNDED_SIZES:
            self.assertEqual(parameters("The object waves.", width, height, 1, 8)["width"], width)
        with self.assertRaises(ValueError): parameters("Wave.", 704, 512, 1, 8)

    def fixture(self, root):
        lock = copy.deepcopy(manifest())
        index = {"_class_name": lock["pipeline"], "boundary_ratio": 0.9, "expand_timesteps": False,
            "scheduler": ["diffusers", "UniPCMultistepScheduler"], "text_encoder": ["transformers", "UMT5EncoderModel"],
            "tokenizer": ["transformers", "T5TokenizerFast"], "transformer": ["diffusers", "WanTransformer3DModel"],
            "transformer_2": ["diffusers", "WanTransformer3DModel"], "vae": ["diffusers", "AutoencoderKLWan"],
            "image_encoder": [None, None], "image_processor": [None, None]}
        content = {"model_index.json": json.dumps(index), "scheduler/scheduler_config.json": json.dumps({"_class_name": lock["scheduler"], "flow_shift": 3}),
                   "transformer/fixture.safetensors": "not real weights; hash verification fixture only"}
        lock["files"] = []
        for name, text in content.items():
            path = root / name
            path.parent.mkdir(exist_ok=True)
            path.write_text(text)
            lock["files"].append({"path": name, "bytes": len(text.encode()), "sha256": hashlib.sha256(text.encode()).hexdigest()})
        return lock

    def test_checksum_corruption_missing_files_and_symlinks_fail_before_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            lock = self.fixture(root)
            self.assertEqual(verify_directory(root, lock), root.resolve())
            file = root / "transformer/fixture.safetensors"
            original = file.read_bytes()
            file.write_bytes(b"x" * len(original))
            with self.assertRaises(ValueError): verify_directory(root, lock)
            file.unlink()
            with self.assertRaises(ValueError): verify_directory(root, lock)
            other = root / "other.json"
            other.write_bytes(original)
            file.symlink_to(other)
            with self.assertRaises(ValueError): verify_directory(root, lock)

    def test_missing_real_snapshot_never_imports_native_models(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): load_pipeline(folder)

    def test_unsafe_manifests_and_recipe_drift_fail(self):
        for change in (lambda m: m.update(revision="main"), lambda m: m.update(steps=[50]),
                lambda m: m["files"][0].update(path="../escape.json"), lambda m: m["files"][0].update(path="weights.bin"),
                lambda m: m["files"].append(m["files"][0])):
            lock = copy.deepcopy(manifest())
            change(lock)
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / "lock.json"
                path.write_text(json.dumps(lock))
                with self.assertRaises(ValueError): manifest(path)


if __name__ == "__main__": unittest.main()
