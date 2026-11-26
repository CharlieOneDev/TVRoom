#!/usr/bin/env python3
"""Validate a PlayCanvas export without modifying its asset bytes."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_FILES = ('archive.json', 'project.json', 'assets.json', 'scenes.json', 'devlog.json')


def check():
    errors = []
    data = {}
    for name in ARCHIVE_FILES:
        try:
            data[name] = json.loads((ROOT / name).read_text())
        except (OSError, ValueError) as exc:
            errors.append(f'{name}: {exc}')
    for asset_id, asset in data.get('assets.json', {}).items():
        info = asset.get('file')
        if not info:
            continue
        path = ROOT / 'files' / 'assets' / asset_id / str(asset['revision']) / info['filename']
        if not path.is_file():
            errors.append(f'Missing asset: {path.relative_to(ROOT)}')
            continue
        content = path.read_bytes()
        if len(content) != info['size']:
            errors.append(f'Asset size mismatch: {path.relative_to(ROOT)}')
        if info.get('hash') and hashlib.md5(content).hexdigest() != info['hash']:
            errors.append(f'Asset hash mismatch: {path.relative_to(ROOT)}')
    for script_id in data.get('project.json', {}).get('settings', {}).get('scripts', []):
        if str(script_id) not in data.get('assets.json', {}):
            errors.append(f'Missing script metadata: {script_id}')
    for path in ROOT.rglob('*'):
        if not path.is_file() or any(part in {'.git', 'dist', 'node_modules'} for part in path.relative_to(ROOT).parts):
            continue
        if path.stat().st_size >= 100 * 1024 * 1024:
            errors.append(f'File exceeds 100 MiB: {path.relative_to(ROOT)}')
        if path.suffix == '.md':
            for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
                if re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                    continue
                target = unquote(target.split('#')[0])
                if not (path.parent / target).exists():
                    errors.append(f'Broken link in {path.name}: {target}')
    node = shutil.which('node')
    scripts = sorted((ROOT / 'files').rglob('*.mjs')) + sorted((ROOT / 'files').rglob('*.js'))
    if not node:
        errors.append('Node.js 20+ is required for JavaScript syntax checks.')
    else:
        for path in scripts:
            result = subprocess.run([node, '--check', str(path)], capture_output=True, text=True)
            if result.returncode:
                errors.append(result.stderr.strip())
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'PASS: {len(data.get("assets.json", {}))} asset records, {len(scripts)} scripts, archive hashes, file sizes, and local documentation links.')
    print('Runtime rendering, browser audio, and PlayCanvas import require manual verification.')
    return 0


if __name__ == '__main__':
    sys.exit(check())
