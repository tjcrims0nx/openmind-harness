#!/usr/bin/env bash
# OpenMind Harness — Android via Termux. Installs the SAME harness as the
# iOS app and the Linux setup: OpenCode + the universal multi-provider
# config from opencode.json. No separate Android app — Termux
# is the Android route.
#
# In Termux (on the phone):
#   pkg update && pkg install -y git curl
#   git clone https://github.com/tjcrims0nx/openmind-harness.git
#   bash openmind-harness/termux-setup.sh [--no-launch]
#
# Install method: the native Android/aarch64 OpenCode build from
# guysoft/opencode-termux (upstream OpenCode publishes no Android binary,
# and its Linux glibc binary cannot run under Android's Bionic libc — it
# dies with "Bad system call"). The release is verified against its
# published SHA256SUMS before installing. Version note: the Termux build
# is OpenCode 1.17.9 (guysoft v0.2.1, latest Android release as of
# 2026-11-21) vs 1.19.6 on iOS/Linux — same config, slightly older engine.
# Fallback for the exact 1.19.6 build: proot-distro Ubuntu, then run the
# Linux setup inside it (see README.md).
#
# What it does:
#   1. Installs the Android OpenCode build + ripgrep (required dep).
#   2. Installs the universal config to ~/.config/opencode/opencode.json,
#      the starter skill to ~/.config/opencode/skills/, and the guard
#      plugin to ~/.config/opencode/plugins/.
#   3. Launches `opencode web` in the foreground (unless --no-launch):
#      the web UI on http://127.0.0.1:4097 — open it in the phone browser.
#
# Keys are NEVER stored by this script. Export them in Termux first
# (or add them in the web UI's model picker with /connect), e.g.:
#   export OPENAI_API_KEY=sk-...
#   export EXPLABS_API_KEY=...
# With no keys set, the UI still starts — it prompts for a key when a model
# is first used. The free fallback (Experiential Labs deepseek-v4.1-flash:free)
# needs only EXPLABS_API_KEY.
#
# Notes for the phone:
#   - Keep Termux alive for long runs: run `termux-wake-lock` first, or the
#     system may kill Termux (and the server) in the background.
#   - The workspace lives in Termux's home (~/workspace). To reach files in
#     shared storage, run `termux-setup-storage` once and use ~/storage.
#   - The UI binds 127.0.0.1 (this phone only). Do not expose it with
#     --hostname 0.0.0.0 without setting OPENCODE_SERVER_PASSWORD first.
set -euo pipefail

# Pinned Android release (verified 2026-11-21). Bump both lines together.
GUYSOFT_TAG="${GUYSOFT_TAG:-v0.2.1}"
OPENCODE_ANDROID_VERSION="${OPENCODE_ANDROID_VERSION:-1.17.9}"
ZIP="opencode-${OPENCODE_ANDROID_VERSION}-android-aarch64.zip"
BASE_URL="https://github.com/guysoft/opencode-termux/releases/download/${GUYSOFT_TAG}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[ "$(uname -m)" = "aarch64" ] || { echo "ERROR: Termux OpenCode needs aarch64 (this device reports '$(uname -m)')." >&2; exit 1; }
[ -n "${PREFIX:-}" ] || { echo "ERROR: \$PREFIX is not set — run this inside Termux, not a plain shell." >&2; exit 1; }

# --- config source: repo clone (this script is meant to run from a clone) ---
CONFIG_SRC="$SCRIPT_DIR/opencode.json"
SKILLS_SRC="$SCRIPT_DIR/skills"
PLUGINS_SRC="$SCRIPT_DIR/plugins"
DELETE_ENV_SRC="$SCRIPT_DIR/scripts/delete-env.sh"
COMMAND_SRC="$SCRIPT_DIR/commands/delete-env.md"
SET_CUSTOM_ENDPOINT_SRC="$SCRIPT_DIR/scripts/set-custom-endpoint.sh"
CUSTOM_ENDPOINT_COMMAND_SRC="$SCRIPT_DIR/commands/custom-endpoint.md"
ANTIGRAVITY_BRIDGE_SRC="$SCRIPT_DIR/scripts/antigravity-bridge.mjs"
ANTIGRAVITY_LOGIN_SRC="$SCRIPT_DIR/scripts/antigravity-login.mjs"
[ -f "$CONFIG_SRC" ] || { echo "ERROR: opencode.json not found next to this script — run it from a clone of the repo." >&2; exit 1; }

if ! command -v python3 >/dev/null 2>&1; then
    pkg install -y python
fi

# --- 1. Android OpenCode build (skip if already installed) ---
if command -v opencode >/dev/null 2>&1; then
    echo "opencode already installed: $(opencode --version)"
else
    echo "Installing Termux packages (unzip, ripgrep, nodejs)..."
    pkg install -y unzip ripgrep nodejs
    TMP="$(mktemp -d)"
    echo "Downloading OpenCode ${OPENCODE_ANDROID_VERSION} for Android/aarch64..."
    curl -fsSL -o "$TMP/$ZIP" "$BASE_URL/$ZIP"
    curl -fsSL -o "$TMP/SHA256SUMS" "$BASE_URL/SHA256SUMS"
    ( cd "$TMP" && grep " $ZIP\$" SHA256SUMS | sha256sum -c - ) \
        || { echo "ERROR: SHA256 mismatch for $ZIP — refusing to install." >&2; exit 1; }
    echo "SHA256 verified."
    unzip -o -q "$TMP/$ZIP" -d "$TMP/unzipped"
    mkdir -p "$PREFIX/libexec/opencode" "$PREFIX/lib"
    install -m 0755 "$TMP/unzipped/opencode" "$PREFIX/bin/opencode"
    install -m 0755 "$TMP/unzipped/opencode.bin" "$PREFIX/libexec/opencode/opencode.bin"
    for lib in libtagfix.so libc++_shared.so libopentui.so; do
        [ -f "$TMP/unzipped/$lib" ] && install -m 0644 "$TMP/unzipped/$lib" "$PREFIX/lib/$lib"
    done
    rm -rf "$TMP"
    echo "installed: $(opencode --version)"
fi

# Termux keeps its CA bundle outside the usual paths; point TLS at it so
# the harness can reach the provider APIs.
if ! grep -q "SSL_CERT_FILE=.*etc/tls/cert.pem" ~/.bashrc 2>/dev/null; then
    echo "export SSL_CERT_FILE=\$PREFIX/etc/tls/cert.pem" >> ~/.bashrc
fi
export SSL_CERT_FILE="$PREFIX/etc/tls/cert.pem"

# --- 2. Universal config + starter skill + guard plugin (same files the iOS app ships) ---
mkdir -p ~/.config/opencode/skills ~/.config/opencode/plugins
cp "$CONFIG_SRC" ~/.config/opencode/opencode.json
cp -R "$SKILLS_SRC/." ~/.config/opencode/skills/
cp -R "$PLUGINS_SRC/." ~/.config/opencode/plugins/
echo "config installed: ~/.config/opencode/opencode.json (default model openai/gpt-5)"
echo "skills installed: ~/.config/opencode/skills/ (openmind-harness)"
echo "plugins installed: ~/.config/opencode/plugins/ (openmind-guard)"
mkdir -p "$PREFIX/bin" ~/.config/opencode/command
install -m 0755 "$DELETE_ENV_SRC" "$PREFIX/bin/openmind-delete-env"
cp "$COMMAND_SRC" ~/.config/opencode/command/delete-env.md
echo "delete-env installed: $PREFIX/bin/openmind-delete-env (/delete-env in the web UI)"
install -m 0755 "$SET_CUSTOM_ENDPOINT_SRC" "$PREFIX/bin/openmind-set-custom-endpoint"
cp "$CUSTOM_ENDPOINT_COMMAND_SRC" ~/.config/opencode/command/custom-endpoint.md
echo "custom-endpoint installed: $PREFIX/bin/openmind-set-custom-endpoint (/custom-endpoint in the web UI)"
install -m 0755 "$ANTIGRAVITY_BRIDGE_SRC" "$PREFIX/bin/openmind-antigravity-bridge.mjs"
install -m 0755 "$ANTIGRAVITY_LOGIN_SRC" "$PREFIX/bin/openmind-antigravity-login.mjs"
echo "antigravity installed: $PREFIX/bin/openmind-antigravity-login.mjs (sign in with your Google account)"
echo "  then start the bridge: node $PREFIX/bin/openmind-antigravity-bridge.mjs"

# --- 3. Launch (unless asked not to) ---
if [ "${1:-}" = "--no-launch" ]; then
    echo
    echo "Ready. Launch the web UI with:"
    echo "  opencode web        # http://127.0.0.1:4097 — open in the phone browser"
    echo "Or the API server with:  opencode serve   # http://127.0.0.1:4096"
    exit 0
fi
echo
echo "Starting the web UI — open http://127.0.0.1:4097 in the phone browser (Ctrl-C to stop)."
echo "Tip: run 'termux-wake-lock' first so the phone does not kill Termux mid-run."
echo "Model picker (top of the UI) switches providers; default is openai/gpt-5,"
echo "free fallback is experientiallabs/deepseek-v4.1-flash:free."
echo "ChatGPT Plus? Sign in once first: opencode auth login --provider openai"
echo "— GPT-5 then uses your subscription, no API credits needed."
echo "Agents: build (default), fast (free fallback), reviewer (read-only subagent)."
exec opencode web
