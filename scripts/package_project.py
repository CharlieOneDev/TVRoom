#!/usr/bin/env python3
"""Create an importable archive with the original export files at ZIP root."""
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED
from check_project import ARCHIVE_FILES, ROOT, check


def main():
    if check():
        return 1
    output = ROOT / 'dist' / 'TVRoom.zip'
    output.parent.mkdir(exist_ok=True)
    paths = [ROOT / name for name in ARCHIVE_FILES]
    for directory in ('files', 'thumbnails'):
        paths.extend(p for p in (ROOT / directory).rglob('*') if p.is_file() and p.name != '.DS_Store')
    temporary = output.with_suffix('.zip.tmp')
    try:
        with ZipFile(temporary, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(paths):
                archive.write(path, path.relative_to(ROOT).as_posix())
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Created {output.relative_to(ROOT)} ({output.stat().st_size / 1024**2:.1f} MiB).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
