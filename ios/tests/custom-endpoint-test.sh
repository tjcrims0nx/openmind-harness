#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

test_home="$fixture/home with spaces"
config="$test_home/.config/opencode"
mkdir -p "$config"
cp "$repo/opencode.json" "$config/opencode.json"
printf 'export OTHER_PROVIDER_KEY=fixture\n' > "$config/.env"

endpoint='https://example.invalid/v1?a=1&b=2'
key='fixture with spaces, a quote '"'"' and $(exit 97)'
helper=(bash "$repo/scripts/set-custom-endpoint.sh" --home "$test_home")

output=$(printf '%s\n' "$key" | "${helper[@]}" --url "$endpoint" --model example/chat --add-rc)
[[ "$output" == *custom/example/chat* && "$output" != *"$key"* ]]
bash -c '
    . "$1/.bashrc"
    python3 -c "import os, sys; assert os.environ[\"OPENMIND_CUSTOM_BASE_URL\"] == sys.argv[1]; assert os.environ[\"OPENMIND_CUSTOM_API_KEY\"] == sys.argv[2]" "$2" "$3"
' bash "$test_home" "$endpoint" "$key"
python3 - "$config" <<'PY'
import json
from pathlib import Path
import sys

config = Path(sys.argv[1])
assert (config / ".env").stat().st_mode & 0o777 == 0o600
assert json.loads((config / "opencode.json").read_text())["provider"]["custom"]["models"]["example/chat"]["name"] == "example/chat"
PY

output=$("${helper[@]}" --show)
[[ "$output" == *"Bearer key: set"* && "$output" != *"$key"* ]]
if printf '%s\n' "$key" | "${helper[@]}" --url https:// --model example/chat; then
    echo "Expected invalid URL to fail" >&2
    exit 1
fi
if "${helper[@]}" --url; then
    echo "Expected missing option value to fail" >&2
    exit 1
fi
"${helper[@]}" --clear
[[ $(cat "$config/.env") == 'export OTHER_PROVIDER_KEY=fixture' ]]
echo "Custom endpoint smoke test passed"
