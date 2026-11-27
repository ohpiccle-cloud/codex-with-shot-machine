"""Archive the built GPT Sites bundle, including its hosting manifest."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

sites = Path(__file__).resolve().parents[1]
dist = sites / 'dist'
target = sites / 'shot-erp-gpt-sites-mobile.zip'
required = ('.openai/hosting.json', 'server/index.js', 'server/drizzle/0002_shot_history.sql')
if not all((dist / name).is_file() for name in required):
    raise SystemExit('Build the GPT Sites bundle before packaging it.')

with ZipFile(target, 'w', compression=ZIP_DEFLATED) as bundle:
    for path in sorted(dist.rglob('*')):
        if path.is_file():
            bundle.write(path, path.relative_to(dist).as_posix())
with ZipFile(target) as bundle:
    if bundle.testzip() is not None or not set(required).issubset(bundle.namelist()):
        raise SystemExit('ZIP verification failed.')
print(target)
