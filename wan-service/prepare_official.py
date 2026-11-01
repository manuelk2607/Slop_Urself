"""Explicit public weight preparation, never inside a GPU function.

Startup preparation additionally requires the designated remote Space identity.
The default app does not download anything; no paid storage is requested here.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from official import manifest,verify_directory


def prepare(destination):
    lock=manifest();destination=Path(destination)
    if destination.is_symlink():raise ValueError('No snapshot symlinks')
    destination.mkdir(parents=True,exist_ok=True)
    destination=destination.resolve()
    required=sum(item['bytes'] for item in lock['files'])
    # Only complete hash-verified files reduce the remaining download estimate.
    # A corrupt same-size file or symlink cannot disguise insufficient storage.
    existing=0
    for item in lock['files']:
        file=destination/item['path']
        current=file
        while current!=destination:
            if current.is_symlink():raise ValueError('No snapshot symlinks')
            current=current.parent
        if not file.is_file() or file.stat().st_size!=item['bytes']:continue
        digest=hashlib.sha256()
        with file.open('rb') as stream:
            for chunk in iter(lambda:stream.read(8*1024*1024),b''):digest.update(chunk)
        if digest.hexdigest()==item['sha256']:existing+=item['bytes']
    free=shutil.disk_usage(destination).free
    print(json.dumps({'event':'public_snapshot_preflight','requiredBytes':required,
        'verifiedExistingBytes':existing,'freeBytes':free,'reserveBytes':2*1024**3,'gpuCalls':0}),flush=True)
    if free<max(0,required-existing)+2*1024**3:
        raise ValueError('Insufficient free disk for the fixed public snapshot plus 2GiB reserve')
    # local_dir avoids a second full blob cache; no Xet chunk cache is needed.
    os.environ['HF_HUB_DISABLE_XET']='1'
    os.environ['HF_XET_CHUNK_CACHE_SIZE_BYTES']='0'
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=lock['id'],revision=lock['revision'],local_dir=str(destination),
        allow_patterns=[item['path'] for item in lock['files']],token=False,max_workers=2)
    verify_directory(destination,lock)
    print(json.dumps({'event':'public_snapshot_verified','files':len(lock['files']),
        'bytes':required,'revision':lock['revision'],'gpuCalls':0}),flush=True)


def prepare_on_space(destination):
    if (os.environ.get('SPACE_ID')!='Manuel2607/SlopUrself-Wan22-GPU-Test'
            or not re.fullmatch(r'[a-z0-9-]+\.hf\.space',os.environ.get('SPACE_HOST',''))
            or os.environ.get('WAN_ENABLE_MODEL_LOADING')!='yes'
            or os.environ.get('WAN_PREPARE_PUBLIC_WEIGHTS')!='yes'
            or os.environ.get('WAN_PREPARATION_ONLY')!='yes'):
        raise ValueError('Remote-only preparation requires the designated Space and explicit preparation-only flags')
    prepare(destination)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--download-public-snapshot',action='store_true',required=True)
    parser.add_argument('--destination',default='models/official')
    args=parser.parse_args()
    prepare(args.destination)


if __name__=='__main__':main()
