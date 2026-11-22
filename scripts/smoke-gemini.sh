#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required" >&2
  exit 1
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT

export HOME="$profile"
export XDG_CONFIG_HOME="$profile/.config"
export XDG_DATA_HOME="$profile/data"
export XDG_STATE_HOME="$profile/state"
export XDG_CACHE_HOME="$profile/cache"
export OPENCODE_DISABLE_AUTOUPDATE=true
export OPENCODE_DISABLE_MODELS_FETCH=true
export OMH_WORKSPACE="$profile/project"
export OMH_STATE_DIR="$profile/runtime"
mkdir -p "$XDG_CONFIG_HOME/opencode" "$OMH_WORKSPACE"
echo 'OMH MCP smoke test fixture' > "$OMH_WORKSPACE/fixture.txt"

node --input-type=module - "$repo/opencode.json" "$XDG_CONFIG_HOME/opencode/opencode.json" <<'NODE'
import {readFileSync, writeFileSync} from 'node:fs';
const [source, destination] = process.argv.slice(2);
const {model, provider: {google}} = JSON.parse(readFileSync(source, 'utf8'));
if (!model.startsWith('google/')) throw new Error('Expected a configured Gemini model');
writeFileSync(destination, JSON.stringify({
  model,
  provider: {google},
  enabled_providers: ['google'],
  permission: {'*': 'deny', '*omh_queue_read': 'allow'},
}));
NODE

python3 - "$XDG_CONFIG_HOME/opencode/opencode.json" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

with open(sys.argv[1]) as config:
    model = json.load(config)["model"].split("/", 1)[1]
url = "https://generativelanguage.googleapis.com/v1beta/models/"
url += urllib.parse.quote(model, safe="") + ":generateContent"
request = urllib.request.Request(
    url,
    data=json.dumps({"contents": [{"parts": [{"text": "Reply with OK."}]}],
                     "generationConfig": {"maxOutputTokens": 256}}).encode(),
    headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"], "Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(request, timeout=35) as response:
        if not json.load(response).get("candidates"):
            sys.exit("Gemini returned no generation candidates")
except urllib.error.HTTPError as error:
    sys.exit(f"Gemini generation preflight failed (HTTP {error.code})")
except (OSError, ValueError) as error:
    sys.exit(f"Gemini generation preflight failed ({type(error).__name__})")
print("Gemini generated a response with the configured model.")
PY

node "$repo/scripts/install-omh-runtime.mjs" > /dev/null
cd "$OMH_WORKSPACE"
if [[ "$(opencode --version)" != 1.19.6 ]]; then
  echo "Expected OpenCode 1.19.6" >&2
  exit 1
fi
if ! timeout 30s opencode mcp list > "$profile/mcp.log" 2>&1 ||
   ! grep -q 'omh-runtime .*connected' "$profile/mcp.log"; then
  echo "OpenCode did not connect to the installed OMH MCP server" >&2
  exit 1
fi
echo "OpenCode 1.19.6 connected to the installed OMH MCP server."

run_status=0
timeout 75s opencode run --print-logs --format json -- \
  'Use the available OMH queue read tool exactly once with path fixture.txt. Then say done.' \
  > "$profile/events.jsonl" 2> "$profile/opencode.err" || run_status=$?
if (( run_status != 0 )); then
  echo "OpenCode exited with status $run_status. Checking for a completed MCP tool call."
fi

node --input-type=module - "$profile/events.jsonl" "$OMH_STATE_DIR/tasks.json" <<'NODE'
import {readFileSync} from 'node:fs';
const [eventsFile, queueFile] = process.argv.slice(2);
const events = readFileSync(eventsFile, 'utf8').trim().split('\n').flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
if (!events.some(event => event.type === 'tool_use' &&
  event.part?.tool?.endsWith('omh_queue_read') && event.part.state?.status === 'completed')) {
  const error = events.find(event => event.type === 'error')?.error;
  const status = error?.data?.statusCode;
  const detail = Number.isInteger(status) ? ` (HTTP ${status})` : '';
  throw new Error(`Gemini did not complete the OMH MCP tool call${detail}`);
}
const {tasks} = JSON.parse(readFileSync(queueFile, 'utf8'));
if (tasks.length !== 1 || tasks[0].kind !== 'workspace.read' ||
    tasks[0].status !== 'queued' || tasks[0].input?.path !== 'fixture.txt') {
  throw new Error('The MCP call did not queue exactly one fixture read');
}
NODE
if (( run_status != 0 )); then exit "$run_status"; fi

node "$repo/scripts/omh-runtime.mjs" task:run > "$profile/result.json"
node --input-type=module - "$profile/result.json" <<'NODE'
import {readFileSync} from 'node:fs';
const task = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (task.status !== 'completed' || task.result !== 'OMH MCP smoke test fixture\n') {
  throw new Error('The OMH worker did not return the expected fixture');
}
NODE
echo "Gemini called OMH through OpenCode and the worker completed the queued fixture read."
