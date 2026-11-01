"""Preparation guards, no network, real weights or GPU allocation."""
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock,patch
import prepare_official as preparation


class PreparationTests(unittest.TestCase):
    def test_startup_download_never_runs_on_local_machine_or_without_all_remote_flags(self):
        flags={'SPACE_ID':'Manuel2607/SlopUrself-Wan22-GPU-Test','SPACE_HOST':'fixture.hf.space',
            'WAN_ENABLE_MODEL_LOADING':'yes','WAN_PREPARE_PUBLIC_WEIGHTS':'yes','WAN_PREPARATION_ONLY':'yes'}
        for key in flags:
            with patch.dict(os.environ,{**flags,key:''},clear=True),patch.object(preparation,'prepare') as download:
                with self.assertRaises(ValueError):preparation.prepare_on_space('models/official')
                download.assert_not_called()
        with patch.dict(os.environ,flags,clear=True),patch.object(preparation,'prepare') as download:
            preparation.prepare_on_space('models/official');download.assert_called_once_with('models/official')

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
