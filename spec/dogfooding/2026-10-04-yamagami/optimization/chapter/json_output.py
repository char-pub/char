"""Write generated JSON using the repository's already-installed Biome formatter."""
import json
import subprocess
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[5]
BIOME = REPOSITORY / "node_modules" / ".bin" / "biome"


def write_json(path, value):
    target = Path(path).resolve()
    formatted = subprocess.run(
        [str(BIOME), "format", "--stdin-file-path", str(target)],
        cwd=REPOSITORY,
        input=json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
    ).stdout
    target.write_text(formatted, encoding="utf-8")
