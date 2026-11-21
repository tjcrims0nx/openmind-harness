#!/usr/bin/env bash
# Set the harness autonomy level by writing the top-level `permission`
# map in opencode.json (allow / ask / deny per tool). The guard plugin's
# catastrophic-command denylist is separate and always applies once active.
#
# Usage:
#   bash scripts/set-autonomy.sh <level> [config-path]
# Levels:
#   manual     — read/edit/shell/web all ask first
#   auto-read  — reads and web allowed; edits and shell ask
#   auto-edit  — reads, edits, web allowed; shell asks
#   full       — everything allowed (outside-the-workspace paths still ask)
# Default config path is opencode.json next to this script (or the repo
# root when run from a clone). A backup is written to <config>.bak.
# Needs python3. Linux / Termux / macOS; the iOS guest has no python3,
# so set the level on another platform and let the guest image rebuild.
set -euo pipefail

LEVEL="${1:-}"
CONFIG="${2:-$(cd "$(dirname "$0")/.." && pwd)/opencode.json}"
[ -n "$LEVEL" ] || { echo "usage: $0 <manual|auto-read|auto-edit|full> [config-path]" >&2; exit 2; }
[ -f "$CONFIG" ] || { echo "ERROR: config not found: $CONFIG" >&2; exit 1; }

case "$LEVEL" in
  manual)    READ=ask;   EDIT=ask;   BASH=ask;   WEB=ask ;;
  auto-read) READ=allow; EDIT=ask;   BASH=ask;   WEB=allow ;;
  auto-edit) READ=allow; EDIT=allow; BASH=ask;   WEB=allow ;;
  full)      READ=allow; EDIT=allow; BASH=allow; WEB=allow ;;
  *) echo "ERROR: unknown level '$LEVEL' (want manual, auto-read, auto-edit, or full)." >&2; exit 2 ;;
esac

cp "$CONFIG" "$CONFIG.bak"
READ="$READ" EDIT="$EDIT" BASH="$BASH" WEB="$WEB" python3 - "$CONFIG" <<'PYEOF'
import json, os, sys
path = sys.argv[1]
with open(path) as f:
    cfg = json.load(f)
# Outside-the-workspace paths always ask: the workspace jail is a
# boundary, not an autonomy choice.
cfg["permission"] = {
    "read": os.environ["READ"],
    "edit": os.environ["EDIT"],
    "bash": os.environ["BASH"],
    "webfetch": os.environ["WEB"],
    "websearch": os.environ["WEB"],
    "external_directory": "ask",
}
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print("permission map written:")
print(json.dumps(cfg["permission"], indent=2))
PYEOF
echo "Level '$LEVEL' set in $CONFIG (backup: $CONFIG.bak)."
echo "Restart opencode (or the iOS app) for it to take effect."
