"""Create a source archive from the explicitly approved repository manifest."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / '.tooling/repository-manifest.json').read_text(encoding='utf-8'))
paths = {entry['path'] for entry in manifest['text'] + manifest['binary']}
# These are public Android app configuration and the original brand artwork,
# supplied in the local source archive but deliberately omitted from GitHub.
for optional in ('android/app/google-services.json', 'assets/brand/kitty-icon-master.png'):
    if (root / optional).is_file():
        paths.add(optional)
out = root / 'artifacts/KITTY-AI-source.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for name in sorted(paths):
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f'Invalid source path: {name}')
        archive.write(path, arcname='KITTY-AI/' + name)
with ZipFile(out) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Archive CRC verification failed')
print(f'Packaged {len(paths)} source files; ZIP integrity verified: {out.name}')
