"""Snapshot the tested MVP locally, including encrypted variables and history."""
from pathlib import Path
import shutil, sqlite3, sys
source = Path(sys.argv[1]).resolve()
target = Path(__file__).resolve().parents[1]
source_db = source / '.wrangler/state/v3/d1'
target_db = target / '.wrangler/state/v3/d1'
files = list(source_db.rglob('*.sqlite'))
if not files or not (source / '.dev.vars').is_file():
    raise SystemExit('Falta la base local o su archivo de configuración.')
if target_db.exists() or (target / '.dev.vars').exists():
    raise SystemExit('El destino ya tiene datos; no se sobrescribe.')
for file in files:
    destination = target_db / file.relative_to(source_db)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f'file:{file}?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)
    destination.chmod(0o600)
shutil.copyfile(source / '.dev.vars', target / '.dev.vars')
(target / '.dev.vars').chmod(0o600)
print('MVP copiado localmente. Se conservaron variables cifradas, versiones e historial.')
