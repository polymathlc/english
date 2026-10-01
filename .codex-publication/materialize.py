import hashlib
import json
import subprocess
from pathlib import Path

def blob_hash(content):
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()

root = Path.cwd()
deltas = json.loads((root / '.codex-publication/deltas.json').read_text())
for delta in deltas:
    path = Path(delta['path'])
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Invalid file path')
    target = root / path
    if 'baseSha' in delta:
        before = target.read_bytes()
        if blob_hash(before) != delta['baseSha']:
            raise ValueError('Baseline changed: ' + str(path))
        lines = before.decode().splitlines(keepends=True)
        for op in reversed(delta['ops']):
            lines[op['start']:op['start'] + op['delete']] = [op['insert']]
        after = ''.join(lines).encode()
    else:
        if target.exists():
            raise ValueError('Unexpected existing file: ' + str(path))
        after = delta['content'].encode()
    if blob_hash(after) != delta['expectedSha'] or len(after) != delta['bytes']:
        raise ValueError('Content hash mismatch: ' + str(path))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(after)
for helper in ['.github/workflows/codex-materialize.yml', '.codex-publication/deltas.json', '.codex-publication/materialize.py']:
    (root / helper).unlink()
print('Verified and materialized', len(deltas), 'reviewed files; publication helpers removed.')
