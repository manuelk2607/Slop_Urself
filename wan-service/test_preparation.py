"""Preparation guards, no network, real weights or GPU allocation."""
import hashlib
import os
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock,patch
import prepare_official as preparation


class PreparationTests(unittest.TestCase):
    def test_hf_bootstrap_exactly_matches_hash_preinstalled_pins_and_platform_extras(self):
        root=Path(__file__).resolve().parent
        lock=(root/'requirements-space.txt').read_text()
        locked=[re.sub(r'\s*\\$','',line).replace(', ',',') for line in lock.splitlines()
            if re.match(r'^[a-z][a-z0-9_.-]*(?:\[[a-z, ]+\])?==[^\s]+',line)]
        bootstrap=[line for line in (root/'requirements-space-bootstrap.txt').read_text().splitlines() if line and not line.startswith('#')]
        self.assertEqual(locked,bootstrap)
        self.assertIn('gradio[mcp,oauth]==6.31.0',bootstrap)
        self.assertIn('pydantic==2.12.5',bootstrap)
        for name in ['spaces','torch','uvicorn','websockets']:
            self.assertTrue(any(line.startswith(name+'==') for line in bootstrap))
        self.assertNotIn('--hash', '\n'.join(bootstrap))
        self.assertNotIn('git+',lock)
        for block in re.split(r'\n(?=[a-z])',lock.strip()):
            self.assertRegex(block,r'--hash=sha256:[a-f0-9]{64}')

    def test_startup_download_never_runs_on_local_machine_or_without_all_remote_flags(self):
        flags={'SPACE_ID':'Manuel2607/SlopUrself-Wan22-GPU-Test','SPACE_HOST':'fixture.hf.space',
            'WAN_ENABLE_MODEL_LOADING':'yes','WAN_PREPARE_PUBLIC_WEIGHTS':'yes','WAN_PREPARATION_ONLY':'yes'}
        for key in flags:
            with patch.dict(os.environ,{**flags,key:''},clear=True),patch.object(preparation,'prepare') as download:
                with self.assertRaises(ValueError):preparation.prepare_on_space('models/official')
                download.assert_not_called()
        with patch.dict(os.environ,flags,clear=True),patch.object(preparation,'prepare') as download:
            preparation.prepare_on_space('models/official');download.assert_called_once_with('models/official')

    def test_live_cold_start_prepares_only_in_a_finite_public_two_account_window(self):
        import time,uuid
        flags={'SPACE_ID':'Manuel2607/SlopUrself-Wan22-Validated','SPACE_HOST':'fixture.hf.space',
            'WAN_ENABLE_MODEL_LOADING':'yes','WAN_PREPARE_PUBLIC_WEIGHTS':'yes','WAN_PREPARATION_ONLY':'no',
            'WAN_VALIDATION_ONLY':'yes','WAN_VALIDATION_SUBJECTS':'account-a,account-b',
            'WAN_VALIDATION_CAMPAIGN_ID':str(uuid.uuid4()),'WAN_VALIDATION_EXPIRES_AT':str(int(time.time())+600)}
        with patch.dict(os.environ,flags,clear=True),patch.object(preparation,'prepare') as download:
            preparation.prepare_on_space('models/official');download.assert_called_once()
        with patch.dict(os.environ,{**flags,'WAN_VALIDATION_EXPIRES_AT':'1'},clear=True),patch.object(preparation,'prepare') as download:
            with self.assertRaises(ValueError):preparation.prepare_on_space('models/official')
            download.assert_not_called()

    def test_insufficient_space_and_corrupt_same_size_existing_file_stop_before_network(self):
        contents=b'verified model fixture'
        lock={'id':'fixture/model','revision':'a'*40,'files':[{'path':'weights.safetensors',
            'bytes':len(contents),'sha256':hashlib.sha256(contents).hexdigest()}]}
        with tempfile.TemporaryDirectory() as root,patch.object(preparation,'manifest',return_value=lock),patch.object(preparation.shutil,'disk_usage',return_value=types.SimpleNamespace(free=2*1024**3)),patch.dict(sys.modules,{'huggingface_hub':types.SimpleNamespace(snapshot_download=Mock())}):
            (Path(root)/'weights.safetensors').write_bytes(b'x'*len(contents))
            with self.assertRaises(ValueError):preparation.prepare(root)
            sys.modules['huggingface_hub'].snapshot_download.assert_not_called()

    def test_pinned_public_download_without_second_cache_and_final_verification(self):
        contents=b'verified model fixture'
        lock={'id':'fixture/model','revision':'a'*40,'files':[{'path':'weights.safetensors',
            'bytes':len(contents),'sha256':hashlib.sha256(contents).hexdigest()}]}
        downloader=Mock()
        with tempfile.TemporaryDirectory() as root,patch.object(preparation,'manifest',return_value=lock),patch.object(preparation.shutil,'disk_usage',return_value=types.SimpleNamespace(free=2*1024**3)),patch.object(preparation,'verify_directory') as verify,patch.dict(sys.modules,{'huggingface_hub':types.SimpleNamespace(snapshot_download=downloader)}),patch.dict(os.environ,{},clear=True):
            (Path(root)/'weights.safetensors').write_bytes(contents)
            preparation.prepare(root)
            downloader.assert_called_once_with(repo_id='fixture/model',revision='a'*40,local_dir=str(Path(root).resolve()),
                allow_patterns=['weights.safetensors'],token=False,max_workers=2)
            verify.assert_called_once_with(Path(root).resolve(),lock)
            self.assertEqual(os.environ['HF_HUB_DISABLE_XET'],'1')
            self.assertEqual(os.environ['HF_XET_CHUNK_CACHE_SIZE_BYTES'],'0')
        # Final checksum errors must propagate; downloading is not verification.
        with tempfile.TemporaryDirectory() as root,patch.object(preparation,'manifest',return_value=lock),patch.object(preparation.shutil,'disk_usage',return_value=types.SimpleNamespace(free=3*1024**3)),patch.object(preparation,'verify_directory',side_effect=ValueError('drift')),patch.dict(sys.modules,{'huggingface_hub':types.SimpleNamespace(snapshot_download=Mock())}):
            with self.assertRaises(ValueError):preparation.prepare(root)


if __name__=='__main__':unittest.main()
