#!/usr/bin/env bash
# OpenMind Harness — Linux setup (Cosyra container, Oracle Always Free VM,
# or any Linux server). Installs the SAME harness as the iOS app: OpenCode
# 1.19.6 + the universal multi-provider config from cross-platform/opencode.json.
#
#   curl -fsSL https://raw.githubusercontent.com/tjcrims0nx/openmind-harness-ios/main/cross-platform/linux-setup.sh | bash
#   # or, from a clone of the repo:
#   ./cross-platform/linux-setup.sh [--no-launch]
#
# Install method: the official Linux binary tarball first (deterministic —
# the same release the iOS guest uses, glibc build for the host arch).
# Falls back to `npm i -g opencode-ai` if the download fails (npm's
# platform detection has failed on some glibc systems, so the binary is
# tried first). Node.js is only needed for the npm fallback.
#
# What it does:
#   1. Installs OpenCode 1.19.6 to ~/.local/bin (or reuses it if present).
#   2. Installs the universal config to ~/.config/opencode/opencode.json
#      and the starter skill to ~/.config/opencode/skills/ (from a repo
#      clone; skipped when run standalone via curl).
#   3. Launches `opencode web` in the foreground (unless --no-launch):
#      the web UI on http://127.0.0.1:4097.
#
# Keys are NEVER stored by this script. Export them in your shell first
# (or add them in the web UI's model picker with /connect), e.g.:
#   export OPENAI_API_KEY=sk-...
#   export EXPLABS_API_KEY=...
# With no keys set, the UI still starts — it prompts for a key when a model
# is first used. The free fallback (Experiential Labs deepseek-v4.1-flash:free)
# needs only EXPLABS_API_KEY.
#
# Remote access: by default the UI binds 127.0.0.1 (this machine only).
# To reach it from another device, set a password and bind all interfaces:
#   export OPENCODE_SERVER_PASSWORD='a-long-random-password'
#   opencode web --hostname 0.0.0.0
# (Do not expose it without a password — the server has no login otherwise.)
set -euo pipefail

OPENCODE_VERSION="${OPENCODE_VERSION:-1.19.6}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- config source: repo clone if present, else download from GitHub ---
CONFIG_SRC=""
SKILLS_SRC=""
if [ -f "$SCRIPT_DIR/opencode.json" ]; then
    CONFIG_SRC="$SCRIPT_DIR/opencode.json"
    [ -d "$SCRIPT_DIR/../skills" ] && SKILLS_SRC="$SCRIPT_DIR/../skills"
else
    CONFIG_SRC="$(mktemp)"
    echo "Downloading the universal config..."
    curl -fsSL -o "$CONFIG_SRC" "https://raw.githubusercontent.com/tjcrims0nx/openmind-harness-ios/main/cross-platform/opencode.json"
fi

# --- 1. OpenCode (binary tarball first, npm fallback) ---
if command -v opencode >/dev/null 2>&1; then
    echo "opencode already installed: $(opencode --version)"
else
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)  BIN_ARCH="x64" ;;
        aarch64|arm64) BIN_ARCH="arm64" ;;
        *) echo "ERROR: unsupported architecture '$ARCH' (need x86_64 or aarch64)." >&2; exit 1 ;;
    esac
    TARBALL="opencode-linux-${BIN_ARCH}.tar.gz"
    echo "Installing OpenCode $OPENCODE_VERSION ($TARBALL)..."
    TMP="$(mktemp -d)"
    if curl -fsSL -o "$TMP/$TARBALL" "https://github.com/sst/opencode/releases/download/v${OPENCODE_VERSION}/$TARBALL" \
        && tar -xzf "$TMP/$TARBALL" -C "$TMP" \
        && [ -x "$TMP/opencode" ]; then
        mkdir -p ~/.local/bin
        install -m 0755 "$TMP/opencode" ~/.local/bin/opencode
        export PATH="$HOME/.local/bin:$PATH"
        echo "installed: ~/.local/bin/opencode ($(opencode --version))"
        echo "Make sure ~/.local/bin is on your PATH (add to ~/.bashrc if needed):"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    else
        echo "Binary download failed — falling back to npm..."
        if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
            echo "Node.js not found — installing Node.js 22 LTS..."
            if [ -f /etc/debian_version ] && command -v apt-get >/dev/null 2>&1; then
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                sudo apt-get install -y nodejs
            elif command -v dnf >/dev/null 2>&1; then
                sudo dnf install -y nodejs npm
            else
                echo "ERROR: install Node.js 22 LTS first (https://nodejs.org), then re-run this script." >&2
                exit 1
            fi
        fi
        npm i -g "opencode-ai@$OPENCODE_VERSION"
    fi
    rm -rf "$TMP"
fi
command -v opencode >/dev/null 2>&1 || { echo "ERROR: opencode install failed." >&2; exit 1; }

# --- 2. Universal config + starter skill (same files the iOS app ships) ---
mkdir -p ~/.config/opencode
cp "$CONFIG_SRC" ~/.config/opencode/opencode.json
echo "config installed: ~/.config/opencode/opencode.json (default model openai/gpt-5)"
if [ -n "$SKILLS_SRC" ]; then
    mkdir -p ~/.config/opencode/skills
    cp -R "$SKILLS_SRC/." ~/.config/opencode/skills/
    echo "skills installed: ~/.config/opencode/skills/ (openmind-harness)"
else
    echo "skills skipped (run from a repo clone to install them: skills/ -> ~/.config/opencode/skills/)"
fi

# --- 3. Launch (unless asked not to) ---
if [ "${1:-}" = "--no-launch" ]; then
    echo
    echo "Ready. Launch the web UI with:"
    echo "  opencode web        # http://127.0.0.1:4097"
    echo "Or the API server with:  opencode serve   # http://127.0.0.1:4096"
    exit 0
fi
echo
echo "Starting the web UI — open http://127.0.0.1:4097 (Ctrl-C to stop)."
echo "Model picker (top of the UI) switches providers; default is openai/gpt-5,"
echo "free fallback is experientiallabs/deepseek-v4.1-flash:free."
echo "ChatGPT Plus? Sign in once first: opencode auth login --provider openai"
echo "— GPT-5 then uses your subscription, no API credits needed."
echo "Agents: build (default), fast (free fallback), reviewer (read-only subagent)."
exec opencode web
