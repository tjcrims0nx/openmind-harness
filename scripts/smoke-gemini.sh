#!/usr/bin/env bash
set -euo pipefail

mode="${1:-live}"
if [[ "$mode" != live && "$mode" != fixture ]]; then
  echo "Usage: smoke-gemini.sh [live|fixture]" >&2
  exit 1
fi
if [[ "$mode" == live && -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required" >&2
  exit 1
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="$(mktemp -d)"
fixture_pid=
cleanup() {
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; fi
  rm -rf "$profile"
}
trap cleanup EXIT

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

fixture_url=
if [[ "$mode" == fixture ]]; then
  export GEMINI_API_KEY=fixture-only
  python3 "$repo/scripts/smoke-gemini-fixture.py" "$profile/fixture.port" > "$profile/fixture.log" 2>&1 &
  fixture_pid=$!
  for ((attempt = 0; attempt < 50; attempt++)); do
    if [[ -s "$profile/fixture.port" ]]; then break; fi
    sleep 0.1
  done
  fixture_url="http://127.0.0.1:$(cat "$profile/fixture.port")/v1beta"
fi

node --input-type=module - "$repo/opencode.json" "$XDG_CONFIG_HOME/opencode/opencode.json" "$fixture_url" <<'NODE'
import {readFileSync, writeFileSync} from 'node:fs';
const [source, destination, fixtureUrl] = process.argv.slice(2);
const {model, provider: {google}} = JSON.parse(readFileSync(source, 'utf8'));
if (!model.startsWith('google/')) throw new Error('Expected a configured Gemini model');
if (fixtureUrl) google.options = {...google.options, baseURL: fixtureUrl};
writeFileSync(destination, JSON.stringify({
  model,
  small_model: model,
  provider: {google},
  enabled_providers: ['google'],
  permission: {'*': 'deny', 'omh-runtime_omh_queue_read': 'allow'},
}));
NODE

if [[ "$mode" == live ]]; then
python3 - "$XDG_CONFIG_HOME/opencode/opencode.json" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

with open(sys.argv[1]) as file:
    config = json.load(file)
primary = config["model"].split("/", 1)[1]
models = dict.fromkeys([primary, *config["provider"]["google"].get("models", {})])
for model in models:
    url = "https://generativelanguage.googleapis.com/v1beta/models/"
    url += urllib.parse.quote(model, safe="") + ":generateContent"
    request = urllib.request.Request(
        url,
        data=json.dumps({"contents": [{"parts": [{"text": "Reply with OK."}]}],
                         "generationConfig": {"maxOutputTokens": 256}}).encode(),
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"], "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            if not json.load(response).get("candidates"):
                sys.exit(f"Gemini returned no generation candidates for {model}")
    except urllib.error.HTTPError as error:
        print(f"Gemini generation preflight for {model} failed (HTTP {error.code}).", flush=True)
        if error.code in (429, 503):
            continue
        raise SystemExit(1)
    except (TimeoutError, urllib.error.URLError) as error:
        print(f"Gemini generation preflight for {model} failed ({type(error).__name__}).", flush=True)
        continue
    except (OSError, ValueError) as error:
        sys.exit(f"Gemini generation preflight failed ({type(error).__name__})")
    config["model"] = config["small_model"] = f"google/{model}"
    with open(sys.argv[1], "w") as file:
        json.dump(config, file)
    print(f"Gemini generated a response with {model}.", flush=True)
    break
else:
    sys.exit("Configured Gemini models are temporarily unavailable for generation.")
PY
fi

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
  'Use the available OMH queue read tool with path fixture.txt. Its queued status means success. As soon as it returns a task ID, reply done without polling or making another call.' \
  > "$profile/events.jsonl" 2> "$profile/opencode.err" || run_status=$?
if (( run_status != 0 )); then
  echo "OpenCode exited with status $run_status. Checking for a completed MCP tool call."
fi

task_count="$(node --input-type=module - "$profile/events.jsonl" "$OMH_STATE_DIR/tasks.json" <<'NODE'
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const [eventsFile, queueFile] = process.argv.slice(2);
const events = readFileSync(eventsFile, 'utf8').trim().split('\n').flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const calls = events.filter(event => event.type === 'tool_use' &&
  event.part?.tool === 'omh-runtime_omh_queue_read' && event.part.state?.status === 'completed');
if (!calls.length) {
  const error = events.find(event => event.type === 'error')?.error;
  const status = error?.data?.statusCode;
  const detail = Number.isInteger(status) ? ` (HTTP ${status})` : '';
  throw new Error(`Gemini did not complete the OMH MCP tool call${detail}`);
}
const {tasks} = JSON.parse(readFileSync(queueFile, 'utf8'));
const taskIds = new Set(calls.map(call => JSON.parse(call.part.state.output).id));
const expectedPath = resolve('fixture.txt');
if (tasks.length < 1 || tasks.length > 10 || tasks.length !== taskIds.size ||
    tasks.some(task => !taskIds.has(task.id) || task.kind !== 'workspace.read' ||
      task.status !== 'queued' || typeof task.input?.path !== 'string' ||
      resolve(task.input.path) !== expectedPath)) {
  throw new Error(`Expected only fixture reads from verified MCP calls. Saw ${calls.length} calls and ${tasks.length} tasks.`);
}
console.log(tasks.length);
NODE
)"
if (( run_status != 0 )); then exit "$run_status"; fi

for ((task = 0; task < task_count; task++)); do
  node "$repo/scripts/omh-runtime.mjs" task:run > "$profile/result.json"
  node --input-type=module - "$profile/result.json" <<'NODE'
import {readFileSync} from 'node:fs';
const task = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (task.status !== 'completed' || task.result !== 'OMH MCP smoke test fixture\n') {
  throw new Error('The OMH worker did not return the expected fixture');
}
NODE
done
echo "The Gemini $mode test called OMH through OpenCode and the worker completed the queued fixture read."
