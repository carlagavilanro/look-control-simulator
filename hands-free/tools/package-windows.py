"""Package the Windows companion after desktop-control/npm run package.

Run from any folder with Python 3.10+. Only built application files are archived;
saved Windows user profiles and local connection settings are never read.
"""
from pathlib import Path
import json
import os
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
build = root.parent / 'Hands-Free-Screen-Control-Windows'
destination = root / 'website/public/downloads/Hands-Free-Screen-Control-Windows.zip'
version = json.loads((root / 'desktop-control/package.json').read_text(encoding='utf-8'))['version']
manifest = build / 'resources/app/package.json'
if not manifest.exists() or json.loads(manifest.read_text(encoding='utf-8'))['version'] != version:
    raise SystemExit('Build this version first: cd desktop-control && npm ci && npm run package')
for name in ['screen-app.mjs', 'screen-camera.mjs', 'screen-eye-crop.mjs', 'screen-iris-detail.mjs', 'screen-face-detail.mjs', 'screen-typing.mjs']:
    if (build / 'resources/app/public' / name).read_bytes() != (root / 'website/public' / name).read_bytes():
        raise SystemExit(f'Rebuild before packaging: {name} is out of date')
destination.parent.mkdir(parents=True, exist_ok=True)
handle, temporary = tempfile.mkstemp(prefix='hands-free-', suffix='.zip', dir=destination.parent)
os.close(handle)
temporary = Path(temporary)
try:
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, strict_timestamps=False) as archive:
        for file in sorted(build.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(build).as_posix())
    with zipfile.ZipFile(temporary) as archive:
        assert json.loads(archive.read('resources/app/package.json'))['version'] == version
        assert len(json.loads(archive.read('resources/app/public/vendor/english-words.json'))) == 20000
        assert len(archive.read('resources/app/public/vendor/iris.bin')) > 2000000
        if archive.testzip() is not None:
            raise SystemExit('Archive verification failed')
    os.replace(temporary, destination)
finally:
    if temporary.exists():
        temporary.unlink()
print(f'Built and verified Hands Free {version}: {destination}')
