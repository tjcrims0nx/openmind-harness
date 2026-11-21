#!/usr/bin/env bash
set -euo pipefail

home_dir="${HOME:-/root}"
url=""; key=""; model=""; action=save; add_rc=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --url|--key|--model|--home)
            if [ "$#" -lt 2 ] || [[ "$2" == --* ]]; then
                printf '%s requires a value\n' "$1" >&2
                exit 2
            fi
            case "$1" in
                --url) url="$2" ;;
                --key) key="$2" ;;
                --model) model="$2" ;;
                --home) home_dir="$2" ;;
            esac
            shift ;;
        --url=*) url="${1#*=}" ;;
        --key=*) key="${1#*=}" ;;
        --model=*) model="${1#*=}" ;;
        --home=*) home_dir="${1#*=}" ;;
        --show) action=show ;;
        --clear) action=clear ;;
        --add-rc) add_rc=1 ;;
        -h|--help)
            cat <<'HELP'
Usage: openmind-set-custom-endpoint [--url URL] [--model MODEL] [--add-rc] [--home DIR]
       openmind-set-custom-endpoint [--show | --clear] [--home DIR]

Enter the bearer key at the hidden terminal prompt. The --key flag is also
accepted for compatibility. --clear removes the saved URL and key.
HELP
            exit 0 ;;
        *) echo "Unknown option. See --help." >&2; exit 2 ;;
    esac
    shift
done

if ! command -v python3 >/dev/null 2>&1; then
    echo "Install Python 3 to use openmind-set-custom-endpoint." >&2
    exit 1
fi

if [ "$action" = save ]; then
    if [ -z "$url" ]; then read -r -p "API base URL: " url; fi
    if [ -z "$key" ]; then read -rs -p "Bearer key (hidden): " key; echo; fi
    if [ -z "$model" ]; then read -r -p "Model ID: " model; fi
    if [ -z "$key" ] || [ -z "$model" ]; then
        echo "A bearer key and model ID are required." >&2
        exit 2
    fi
fi

# Pass the credential over a pipe instead of putting it in Python's argv.
printf '%s' "$key" | python3 -c '
import json
import os
from pathlib import Path
import re
import shlex
import sys
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit

action, home, url, model = sys.argv[1:]
config = Path(home) / ".config" / "opencode"
env_path = config / ".env"
config_path = config / "opencode.json"
custom_line = re.compile(r"^(?:export )?OPENMIND_(?:CUSTOM_(BASE_URL|API_KEY)|MODEL)=")

def replace(path, contents, mode):
    with NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temp:
        temp_path = Path(temp.name)
        try:
            os.fchmod(temp.fileno(), mode)
            temp.write(contents)
            temp.flush()
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)

def run():
    lines = env_path.read_text().splitlines(keepends=True) if env_path.exists() else []
    if action == "show":
        values = {}
        for line in lines:
            match = custom_line.match(line)
            if match:
                value = line[match.end():].rstrip("\n")
                try:
                    tokens = shlex.split(value)
                    values[match[1]] = tokens[0] if len(tokens) == 1 else value
                except ValueError:
                    values[match[1]] = value
        if values.get("BASE_URL"):
            print("Custom endpoint URL:", values["BASE_URL"])
        else:
            print("No custom endpoint saved.")
        print("Bearer key:", "set" if values.get("API_KEY") else "not set")
        if config_path.exists():
            models = json.loads(config_path.read_text()).get("provider", {}).get("custom", {}).get("models", {})
            print("Models:", ", ".join(sorted(models)) or "(none)")
        return

    other_env = "".join(line for line in lines if not custom_line.match(line))
    if action == "clear":
        if env_path.exists():
            replace(env_path, other_env, 0o600)
        print("Custom endpoint credentials cleared.")
        return

    api_key = sys.stdin.read()
    if any("\n" in value or "\r" in value or "\0" in value for value in (url, api_key, model)):
        sys.exit("Endpoint settings must each fit on one line.")
    endpoint = urlsplit(url)
    if endpoint.scheme not in ("http", "https") or not endpoint.hostname or endpoint.username is not None:
        sys.exit("Enter an HTTP or HTTPS base URL without embedded credentials.")
    if not config_path.is_file():
        sys.exit("OpenCode config is missing. Run the harness setup first.")
    settings = json.loads(config_path.read_text())
    custom = settings["provider"]["custom"]
    custom.setdefault("models", {}).setdefault(model, {"name": model})
    if other_env and not other_env.endswith("\n"):
        other_env += "\n"
    new_env = other_env + f"export OPENMIND_CUSTOM_BASE_URL={shlex.quote(url)}\n"
    new_env += f"export OPENMIND_CUSTOM_API_KEY={shlex.quote(api_key)}\n"
    new_env += f"export OPENMIND_MODEL={shlex.quote(model)}\n"
    replace(config_path, json.dumps(settings, indent=2, ensure_ascii=False) + "\n",
            config_path.stat().st_mode & 0o777)
    replace(env_path, new_env, 0o600)
    print(f"Saved custom/{model}. The endpoint credentials are stored in {env_path}.")

try:
    run()
except (OSError, ValueError, KeyError, TypeError, AttributeError):
    sys.exit("Could not read or update the OpenCode settings. Check the installed config and file permissions.")
' "$action" "$home_dir" "$url" "$model"

if [ "$action" = save ]; then
    printf 'Restart the iOS app. On Linux or Termux, load the credentials before starting OpenCode:\n'
    printf '  . %q\n' "$home_dir/.config/opencode/.env"
    if [ "$add_rc" = 1 ]; then
        printf -v env_path '%q' "$home_dir/.config/opencode/.env"
        source_line="[ -f $env_path ] && . $env_path"
        rc_file="$home_dir/.bashrc"
        if ! grep -qxF -- "$source_line" "$rc_file" 2>/dev/null; then
            printf '\n# OpenMind Harness custom endpoint\n%s\n' "$source_line" >> "$rc_file"
        fi
    fi
fi
