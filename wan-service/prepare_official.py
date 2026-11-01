"""Explicit public weight preparation. Never run by app startup or on a GPU."""
import argparse
from pathlib import Path
import shutil
from official import manifest,verify_directory


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--download-public-snapshot',action='store_true',required=True)
    parser.add_argument('--destination',default='models/official')
    args=parser.parse_args()
    lock=manifest();destination=Path(args.destination)
    if destination.is_symlink():raise ValueError('No snapshot symlinks')
    destination.mkdir(parents=True,exist_ok=True)
    required=sum(item['bytes'] for item in lock['files'])
    existing=sum((destination/item['path']).stat().st_size for item in lock['files'] if (destination/item['path']).is_file())
    if shutil.disk_usage(destination).free<max(0,required-existing)+2*1024**3:
        raise ValueError('Insufficient free disk for the fixed public snapshot plus 2GiB reserve')
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=lock['id'],revision=lock['revision'],local_dir=str(destination),
        allow_patterns=[item['path'] for item in lock['files']],token=False,max_workers=2)
    verify_directory(destination,lock)
    print('Public official snapshot verified; no GPU allocation or inference performed.')


if __name__=='__main__':main()
