#!/usr/bin/env bash
# OpenMind Harness — macOS setup. Installs the SAME harness as the iOS app
# and the Linux setup: OpenCode 1.19.6 + the universal multi-provider
# config from opencode.json.
#
#   curl -fsSL https://raw.githubusercontent.com/tjcrims0nx/openmind-harness/main/macos-setup.sh -o macos-setup.sh
#   bash macos-setup.sh [--no-launch]
#   # or, from a clone of the repo:
#   ./macos-setup.sh [--no-launch]
#
# Install method: the official macOS binary zip first (deterministic —
# the same release the iOS guest and Linux use, Apple Silicon or Intel).
# Falls back to `npm i -g opencode-ai` if the download fails (needs Node.js).
# Node.js 22+ is only needed for the OMH runtime/MCP bridge step; the
# OpenCode binary itself does not need Node.
#
# What it does:
#   1. Installs OpenCode 1.19.6 to ~/.local/bin (or reuses it if present).
#   2. Installs the universal config to ~/.config/opencode/opencode.json,
#      the starter skill to ~/.config/opencode/skills/, and the guard
#      plugin to ~/.config/opencode/plugins/ (from a repo clone; config
#      is downloaded when run standalone via curl).
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
#
# macOS notes:
#   - No admin rights needed; everything installs under your home directory.
#   - The OpenCode binary is cleared of the Gatekeeper quarantine flag after
#     install (xattr), so macOS does not block it as an unsigned download.
#   - ~/.local/bin is added to your PATH in ~/.zshrc (the macOS default
#     shell) and ~/.bash_profile (for bash users).
set -euo pipefail

OPENCODE_VERSION="${OPENCODE_VERSION:-1.19.6}"
NODE_VERSION="${NODE_VERSION:-22.21.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- config source: repo clone if present, else download from GitHub ---
CONFIG_SRC=""
SKILLS_SRC=""
PLUGINS_SRC=""
DELETE_ENV_SRC=""
COMMAND_SRC=""
SET_CUSTOM_ENDPOINT_SRC=""
CUSTOM_ENDPOINT_COMMAND_SRC=""
ANTIGRAVITY_BRIDGE_SRC=""
ANTIGRAVITY_LOGIN_SRC=""
if [ -f "$SCRIPT_DIR/opencode.json" ]; then
    CONFIG_SRC="$SCRIPT_DIR/opencode.json"
    [ -d "$SCRIPT_DIR/skills" ] && SKILLS_SRC="$SCRIPT_DIR/skills"
    [ -d "$SCRIPT_DIR/plugins" ] && PLUGINS_SRC="$SCRIPT_DIR/plugins"
    [ -f "$SCRIPT_DIR/scripts/delete-env.sh" ] && DELETE_ENV_SRC="$SCRIPT_DIR/scripts/delete-env.sh"
    [ -f "$SCRIPT_DIR/commands/delete-env.md" ] && COMMAND_SRC="$SCRIPT_DIR/commands/delete-env.md"
    [ -f "$SCRIPT_DIR/scripts/set-custom-endpoint.sh" ] && SET_CUSTOM_ENDPOINT_SRC="$SCRIPT_DIR/scripts/set-custom-endpoint.sh"
    [ -f "$SCRIPT_DIR/commands/custom-endpoint.md" ] && CUSTOM_ENDPOINT_COMMAND_SRC="$SCRIPT_DIR/commands/custom-endpoint.md"
    [ -f "$SCRIPT_DIR/scripts/antigravity-bridge.mjs" ] && ANTIGRAVITY_BRIDGE_SRC="$SCRIPT_DIR/scripts/antigravity-bridge.mjs"
    [ -f "$SCRIPT_DIR/scripts/antigravity-login.mjs" ] && ANTIGRAVITY_LOGIN_SRC="$SCRIPT_DIR/scripts/antigravity-login.mjs"
else
    CONFIG_SRC="$(mktemp)"
    echo "Downloading the universal config..."
    curl -fsSL -o "$CONFIG_SRC" "https://raw.githubusercontent.com/tjcrims0nx/openmind-harness/main/opencode.json"
fi

# --- helper: ensure Node.js 22+ is available (for the OMH runtime step) ---
# Sets NODE_BIN to a usable node binary, or leaves it empty.
ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local major
        major="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
        if [ -n "$major" ] && [ "$major" -ge 22 ] 2>/dev/null; then
            NODE_BIN="$(command -v node)"
            return 0
        fi
        echo "Node.js $(node --version 2>/dev/null) is too old for the OMH runtime (needs 22+) — trying to install 22..."
    else
        echo "Node.js not found — trying to install Node.js $NODE_VERSION for the OMH runtime..."
    fi
    # Homebrew first (the usual macOS route).
    if command -v brew >/dev/null 2>&1; then
        if brew install node@22 2>/dev/null && [ -x "$(brew --prefix node@22)/bin/node" ]; then
            NODE_BIN="$(brew --prefix node@22)/bin/node"
            export PATH="$(dirname "$NODE_BIN"):$PATH"
            echo "installed Node.js via Homebrew: $("$NODE_BIN" --version)"
            return 0
        fi
        echo "Homebrew Node install failed — trying the official Node.js tarball..."
    fi
    # Official Node.js macOS binary tarball, installed under ~/.local/node.
    local arch node_arch node_tarball tmp
    arch="$(uname -m)"
    case "$arch" in
        arm64)  node_arch="arm64" ;;
        x86_64) node_arch="x64" ;;
        *) echo "ERROR: unsupported architecture '$arch' for Node.js download." >&2; return 1 ;;
    esac
    node_tarball="node-v${NODE_VERSION}-darwin-${node_arch}.tar.gz"
    tmp="$(mktemp -d)"
    if curl -fsSL -o "$tmp/$node_tarball" "https://nodejs.org/dist/v${NODE_VERSION}/$node_tarball" \
        && tar -xzf "$tmp/$node_tarball" -C "$tmp" \
        && [ -x "$tmp/node-v${NODE_VERSION}-darwin-${node_arch}/bin/node" ]; then
        mkdir -p ~/.local/node
        rm -rf ~/.local/node/*
        cp -R "$tmp/node-v${NODE_VERSION}-darwin-${node_arch}/." ~/.local/node/
        NODE_BIN="$HOME/.local/node/bin/node"
        export PATH="$HOME/.local/node/bin:$PATH"
        echo "installed Node.js: $("$NODE_BIN" --version) (~/.local/node)"
        rm -rf "$tmp"
        return 0
    fi
    rm -rf "$tmp"
    echo "WARNING: could not install Node.js 22+ — the OMH runtime/MCP bridge step will be skipped." >&2
    return 1
}

# --- 1. OpenCode (binary zip first, npm fallback) ---
if command -v opencode >/dev/null 2>&1; then
    echo "opencode already installed: $(opencode --version)"
else
    ARCH="$(uname -m)"
    case "$ARCH" in
        arm64)  BIN_ARCH="arm64" ;;
        x86_64) BIN_ARCH="x64" ;;
        *) echo "ERROR: unsupported architecture '$ARCH' (need arm64 or x86_64)." >&2; exit 1 ;;
    esac
    ZIP="opencode-darwin-${BIN_ARCH}.zip"
    echo "Installing OpenCode $OPENCODE_VERSION ($ZIP)..."
    TMP="$(mktemp -d)"
    if curl -fsSL -o "$TMP/$ZIP" "https://github.com/sst/opencode/releases/download/v${OPENCODE_VERSION}/$ZIP" \
        && unzip -o -q "$TMP/$ZIP" -d "$TMP" \
        && [ -x "$TMP/opencode" ]; then
        mkdir -p ~/.local/bin
        install -m 0755 "$TMP/opencode" ~/.local/bin/opencode
        # Clear the Gatekeeper quarantine flag so macOS runs the binary.
        xattr -d com.apple.quarantine ~/.local/bin/opencode 2>/dev/null || true
        export PATH="$HOME/.local/bin:$PATH"
        echo "installed: ~/.local/bin/opencode ($(opencode --version))"
    else
        echo "Binary download failed — falling back to npm..."
        NODE_BIN=""
        ensure_node || true
        if [ -z "${NODE_BIN:-}" ] || ! command -v npm >/dev/null 2>&1; then
            echo "ERROR: npm is not available — install Node.js 22+ (https://nodejs.org) and re-run this script." >&2
            exit 1
        fi
        npm i -g "opencode-ai@$OPENCODE_VERSION"
    fi
    rm -rf "$TMP"
fi
command -v opencode >/dev/null 2>&1 || { echo "ERROR: opencode install failed." >&2; exit 1; }

# Make sure ~/.local/bin is on the PATH for future shells.
for rc in ~/.zshrc ~/.bash_profile; do
    if ! grep -q 'HOME/.local/bin' "$rc" 2>/dev/null; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
        echo "added ~/.local/bin to PATH in $rc"
    fi
done

# --- 2. Universal config + starter skill + guard plugin (same files the iOS app ships) ---
mkdir -p ~/.config/opencode
cp "$CONFIG_SRC" ~/.config/opencode/opencode.json
echo "config installed: ~/.config/opencode/opencode.json (default model google/gemini-3.5-flash-lite)"
NODE_BIN=""
if [ -f "$SCRIPT_DIR/scripts/install-omh-runtime.mjs" ]; then
    if ensure_node; then
        node "$SCRIPT_DIR/scripts/install-omh-runtime.mjs"
        echo "OMH runtime and MCP tools installed"
    else
        echo "OMH runtime skipped: Node.js 22+ is required (install it, then run: node scripts/install-omh-runtime.mjs)"
    fi
else
    echo "OMH runtime skipped: requires a repo checkout (scripts/install-omh-runtime.mjs not found)"
fi
if [ -n "$SKILLS_SRC" ]; then
    mkdir -p ~/.config/opencode/skills
    cp -R "$SKILLS_SRC/." ~/.config/opencode/skills/
    echo "skills installed: ~/.config/opencode/skills/ (openmind-harness)"
else
    echo "skills skipped (run from a repo clone to install them: skills/ -> ~/.config/opencode/skills/)"
fi
if [ -n "$PLUGINS_SRC" ]; then
    mkdir -p ~/.config/opencode/plugins
    cp -R "$PLUGINS_SRC/." ~/.config/opencode/plugins/
    echo "plugins installed: ~/.config/opencode/plugins/ (openmind-guard)"
else
    echo "plugins skipped (run from a repo clone to install them: plugins/ -> ~/.config/opencode/plugins/)"
fi
if [ -n "$DELETE_ENV_SRC" ]; then
    mkdir -p ~/.local/bin
    install -m 0755 "$DELETE_ENV_SRC" ~/.local/bin/openmind-delete-env
    echo "delete-env installed: ~/.local/bin/openmind-delete-env"
else
    echo "delete-env skipped (run from a repo clone to install it: scripts/delete-env.sh -> ~/.local/bin/openmind-delete-env)"
fi
if [ -n "$SET_CUSTOM_ENDPOINT_SRC" ]; then
    mkdir -p ~/.local/bin
    install -m 0755 "$SET_CUSTOM_ENDPOINT_SRC" ~/.local/bin/openmind-set-custom-endpoint
    echo "custom-endpoint installed: ~/.local/bin/openmind-set-custom-endpoint (your own API URL + bearer key)"
else
    echo "custom-endpoint skipped (run from a repo clone to install it: scripts/set-custom-endpoint.sh -> ~/.local/bin/openmind-set-custom-endpoint)"
fi
if [ -n "$ANTIGRAVITY_BRIDGE_SRC" ] && [ -n "$ANTIGRAVITY_LOGIN_SRC" ]; then
    mkdir -p ~/.local/bin
    install -m 0755 "$ANTIGRAVITY_BRIDGE_SRC" ~/.local/bin/openmind-antigravity-bridge.mjs
    install -m 0755 "$ANTIGRAVITY_LOGIN_SRC" ~/.local/bin/openmind-antigravity-login.mjs
    echo "antigravity installed: ~/.local/bin/openmind-antigravity-login.mjs (sign in with your Google account)"
    echo "  then start the bridge: node ~/.local/bin/openmind-antigravity-bridge.mjs"
    echo "  (the antigravity provider in the config points at it on 127.0.0.1:18080)"
else
    echo "antigravity skipped (run from a repo clone to install it: scripts/antigravity-*.mjs -> ~/.local/bin/)"
fi
if [ -n "$COMMAND_SRC" ]; then
    mkdir -p ~/.config/opencode/command
    cp "$COMMAND_SRC" ~/.config/opencode/command/delete-env.md
    echo "command installed: ~/.config/opencode/command/delete-env.md (/delete-env in the web UI)"
else
    echo "command skipped (run from a repo clone to install it: commands/delete-env.md -> ~/.config/opencode/command/)"
fi
if [ -n "$CUSTOM_ENDPOINT_COMMAND_SRC" ]; then
    mkdir -p ~/.config/opencode/command
    cp "$CUSTOM_ENDPOINT_COMMAND_SRC" ~/.config/opencode/command/custom-endpoint.md
    echo "command installed: ~/.config/opencode/command/custom-endpoint.md (/custom-endpoint in the web UI)"
else
    echo "command skipped (run from a repo clone to install it: commands/custom-endpoint.md -> ~/.config/opencode/command/)"
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
echo "Model picker (top of the UI) switches providers; default is google/gemini-3.5-flash-lite,"
echo "free fallback is experientiallabs/deepseek-v4.1-flash:free."
echo "ChatGPT Plus? Sign in once first: opencode auth login --provider openai"
echo "— GPT-5 then uses your subscription, no API credits needed."
echo "Agents: build (default), fast (free fallback), reviewer (read-only subagent)."
exec opencode web
