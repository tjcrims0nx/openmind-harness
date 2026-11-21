#!/usr/bin/env bash
# openmind-set-custom-endpoint — the place to put your own API URL and
# bearer key for the harness's Custom endpoint provider.
#
# The harness's `custom` provider (opencode.json) reads two environment
# variables: OPENMIND_CUSTOM_BASE_URL and OPENMIND_CUSTOM_API_KEY. This
# script saves them to ~/.config/opencode/.env (mode 0600) so they survive
# restarts, and the iOS guest launcher (opencode-serve) sources that file
# before starting the server. On Linux / Termux, source the file once in
# your shell (or let this script add the line to ~/.bashrc) and then start
# the server as usual.
#
# The provider also needs the model id listed in its `models` map in
# opencode.json — without it OpenCode cannot resolve custom/<model-id>
# and the call fails. So this script also records the model id you give
# it in the installed config (~/.config/opencode/opencode.json). The
# bearer key is never printed, not even by --show. The URL is fine to
# show. delete-env removes the .env file again (it is part of the saved
# env); the model entry in opencode.json stays until you remove it.
#
# Usage:
#   openmind-set-custom-endpoint [--url URL] [--key KEY] [--model MODEL] [--show] [--clear] [--home DIR]
#     (no args)        prompt for the URL, the key (hidden) and a model id
#     --url URL        the base URL of your OpenAI-compatible API, e.g.
#                      https://api.example.com/v1
#     --key KEY        the bearer token for that API
#     --model MODEL    a model id that API serves, e.g. deepseek-v4.1-flash:free
#     --show           print the saved URL, model(s) and whether a key is set (never the key)
#     --clear          remove the saved URL and key (model entries stay; remove them
#                      from opencode.json by hand if you no longer want them)
#     --home DIR       use DIR as $HOME (default: $HOME; the guest uses /root)
set -u

HOME_DIR="${HOME:-/root}"
URL=""; KEY=""; MODEL=""; SHOW=0; CLEAR=0; ADD_RC=0

while [ $# -gt 0 ]; do
    case "$1" in
        --url) URL="$2"; shift 2 ;;
        --url=*) URL="${1#--url=}"; shift ;;
        --key) KEY="$2"; shift 2 ;;
        --key=*) KEY="${1#--key=}"; shift ;;
        --model) MODEL="$2"; shift 2 ;;
        --model=*) MODEL="${1#--model=}"; shift ;;
        --show) SHOW=1; shift ;;
        --clear) CLEAR=1; shift ;;
        --add-rc) ADD_RC=1; shift ;;
        --home) HOME_DIR="$2"; shift 2 ;;
        --home=*) HOME_DIR="${1#--home=}"; shift ;;
        -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

CONFIG="$HOME_DIR/.config/opencode"
ENV_FILE="$CONFIG/.env"
OPENCODE_JSON="$CONFIG/opencode.json"

if [ "$SHOW" = 1 ]; then
    if [ -f "$ENV_FILE" ] && grep -q '^OPENMIND_CUSTOM_BASE_URL=' "$ENV_FILE"; then
        echo "Custom endpoint URL: $(grep '^OPENMIND_CUSTOM_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
        if grep -q '^OPENMIND_CUSTOM_API_KEY=.\+' "$ENV_FILE"; then
            echo "Bearer key: set (value not shown)"
        else
            echo "Bearer key: NOT set"
        fi
    else
        echo "No custom endpoint saved."
    fi
    if [ -f "$OPENCODE_JSON" ]; then
        python3 - "$OPENCODE_JSON" <<'PYEOF' 2>/dev/null || true
import json, sys
d = json.load(open(sys.argv[1]))
models = d.get('provider', {}).get('custom', {}).get('models', {})
print('Models: ' + (', '.join(sorted(models)) if models else '(none yet — set one with openmind-set-custom-endpoint --model <id>)'))
PYEOF
    fi
    exit 0
fi

if [ "$CLEAR" = 1 ]; then
    if [ -f "$ENV_FILE" ]; then
        grep -v '^OPENMIND_CUSTOM_BASE_URL=' "$ENV_FILE" | grep -v '^OPENMIND_CUSTOM_API_KEY=' > "$ENV_FILE.tmp" || true
        mv "$ENV_FILE.tmp" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        echo "Custom endpoint removed from $ENV_FILE"
    else
        echo "No custom endpoint saved."
    fi
    exit 0
fi

# --- prompt for anything not given on the command line ---
if [ -z "$URL" ]; then
    printf "API base URL (e.g. https://api.example.com/v1): "
    read -r URL
fi
if [ -z "$KEY" ]; then
    printf "Bearer key (typing is hidden): "
    read -rs KEY
    echo
fi
if [ -z "$MODEL" ]; then
    printf "Model id that API serves (e.g. deepseek-v4.1-flash:free): "
    read -r MODEL
fi

# --- validate ---
case "$URL" in
    http://*|https://*) ;;
    *) echo "That does not look like an API URL — it must start with http:// or https://." >&2; exit 2 ;;
esac
if [ -z "$KEY" ]; then
    echo "No bearer key given — nothing was saved." >&2; exit 2
fi
if [ -z "$MODEL" ]; then
    echo "No model id given — nothing was saved (the provider needs a model listed to call it)." >&2; exit 2
fi

mkdir -p "$CONFIG"
# Keep any other lines already in .env (other providers' keys), replace
# only the two custom-endpoint lines.
if [ -f "$ENV_FILE" ]; then
    grep -v '^OPENMIND_CUSTOM_BASE_URL=' "$ENV_FILE" | grep -v '^OPENMIND_CUSTOM_API_KEY=' > "$ENV_FILE.tmp" || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
fi
{
    echo "OPENMIND_CUSTOM_BASE_URL=$URL"
    echo "OPENMIND_CUSTOM_API_KEY=$KEY"
} >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "Saved. Custom endpoint URL: $URL"
echo "Bearer key: saved (value not shown). File: $ENV_FILE (mode 0600)"

# --- record the model id in the installed config so OpenCode can call it ---
if [ -f "$OPENCODE_JSON" ]; then
    if python3 - "$OPENCODE_JSON" "$MODEL" <<'PYEOF'; then
import json, sys
path, model = sys.argv[1], sys.argv[2]
d = json.load(open(path))
custom = d.setdefault('provider', {}).setdefault('custom', {})
models = custom.setdefault('models', {})
if model not in models:
    models[model] = {'name': model}
json.dump(d, open(path, 'w'), indent=2)
PYEOF
        echo "Model recorded in the config: custom/$MODEL"
    else
        echo "Could not update $OPENCODE_JSON — add the model by hand under provider.custom.models." >&2
    fi
else
    echo "Config $OPENCODE_JSON not found yet — run the setup first, then re-run this script to record the model."
fi
echo
echo "To use it, pick the Custom endpoint provider (model: custom/$MODEL)"
echo "in the model picker, or run: opencode run --model custom/$MODEL \"...\""
echo
echo "iOS app: it picks the file up automatically the next time the app"
echo "starts (the guest launcher sources it)."
echo "Linux / Termux: run this once in your shell, then start the server:"
echo "  source $ENV_FILE"
if [ "$ADD_RC" = 0 ]; then
    printf "Add that source line to ~/.bashrc so it loads every time? [y/N] "
    read -r answer
    case "$answer" in
        y|Y|yes|YES) ADD_RC=1 ;;
    esac
fi
if [ "$ADD_RC" = 1 ]; then
    RC="$HOME_DIR/.bashrc"
    touch "$RC"
    if ! grep -qF "source $ENV_FILE" "$RC"; then
        printf '\n# OpenMind Harness custom endpoint\n[ -f %s ] && source %s\n' "$ENV_FILE" "$ENV_FILE" >> "$RC"
        echo "Added to $RC"
    else
        echo "Already in $RC"
    fi
fi
