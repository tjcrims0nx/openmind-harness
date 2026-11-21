#!/usr/bin/env bash
# Build the guest root filesystem bundled into the OpenMind Harness iOS app:
#   Alpine 3.21 (aarch64) + OpenCode 1.19.6 (official musl arm64 binary)
#
# Everything guest-side runs inside the iSH-ARM64 CLI emulator on macOS, so the
# result is byte-for-byte what the app boots. Output: build/root.tar.gz
#
# Usage: scripts/build-rootfs.sh [--keep-work]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ISH_SRC="${ISH_SRC:-$ROOT/ish-arm64}"
ISH_BUILD="${ISH_BUILD:-$ISH_SRC/build-arm64-release}"
WORK="${WORK:-$ROOT/build/rootfs-work}"
OUT="${OUT:-$ROOT/build/root.tar.gz}"

ALPINE_VER=3.21
ALPINE_TARBALL="alpine-minirootfs-${ALPINE_VER}.0-aarch64.tar.gz"
ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VER}/releases/aarch64/${ALPINE_TARBALL}"
# Pinned OpenCode release; the musl arm64 build runs on Alpine.
# Verified 2026-11-21: the binary in opencode-linux-arm64-musl.tar.gz is an
# ARM aarch64 ELF with interpreter /lib/ld-musl-aarch64.so.1, needing only
# libstdc++.so.6 + libc.musl-aarch64.so.1 (both in the guest image).
OPENCODE_VERSION="${OPENCODE_VERSION:-1.19.6}"
OPENCODE_TARBALL="opencode-linux-arm64-musl.tar.gz"
OPENCODE_URL="https://github.com/sst/opencode/releases/download/v${OPENCODE_VERSION}/${OPENCODE_TARBALL}"

log() { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# The guest node prints this warning on every start; strip it from build logs.
# `sed` deliberately returns success for empty input while `pipefail` still
# propagates a failing emulator command.  The old `grep ... || true` hid guest
# failures and could export a corrupt image as a successful build.
filter() { sed '/expose_wasm/d'; }

ish() {
    # ish <script-on-stdin>; runs /bin/sh inside the fakefs
    "$ISH_BUILD/ish" -f "$WORK/fakefs" /bin/sh 2>&1 | filter
}

[ -x "$ISH_BUILD/ish" ] || die "iSH CLI not built. Run: (cd $ISH_SRC && meson setup build-arm64-release -Dguest_arch=arm64 --buildtype=release && ninja -C build-arm64-release)"
[ -x "$ISH_BUILD/tools/fakefsify" ] || die "fakefsify not built in $ISH_BUILD/tools"

mkdir -p "$WORK" "$(dirname "$OUT")"
cd "$WORK"

log "Alpine minirootfs"
[ -f "$ALPINE_TARBALL" ] || curl -fsSL -o "$ALPINE_TARBALL" "$ALPINE_URL"

log "OpenCode musl arm64 binary"
[ -f "$OPENCODE_TARBALL" ] || curl -fsSL -o "$OPENCODE_TARBALL" "$OPENCODE_URL"
rm -rf opencode-bin && mkdir opencode-bin
tar --no-same-owner -xzf "$OPENCODE_TARBALL" -C opencode-bin
test -x opencode-bin/opencode

log "Create fakefs"
rm -rf fakefs
"$ISH_BUILD/tools/fakefsify" "$ALPINE_TARBALL" fakefs

log "Guest phase 1: packages"
ish <<'EOF'
set -e
echo "nameserver 8.8.8.8" > /etc/resolv.conf
echo "nameserver 1.1.1.1" >> /etc/resolv.conf
apk update >/dev/null
apk add --no-progress bash git curl openssh-client ca-certificates libstdc++ libgcc nodejs python3
EOF

log "Guest phase 2: install opencode + overlay"
# Assemble one payload tree rooted at / (the opencode binary, the iSH node
# polyfills, our overlay) and stream it into the guest in a single pass.
rm -rf payload && mkdir -p payload/usr/local/bin payload/lib
install -m 0755 opencode-bin/opencode payload/usr/local/bin/opencode
mkdir -p payload/usr/local/lib/openmind/openmind_engine
install -m 0755 "$ROOT/../openmind-harness" payload/usr/local/lib/openmind/openmind-harness
cp "$ROOT"/../openmind_engine/*.py "$ROOT"/../openmind_engine/workspace.html payload/usr/local/lib/openmind/openmind_engine/
ln -s ../lib/openmind/openmind-harness payload/usr/local/bin/openmind-harness
cp "$ISH_SRC"/app/RootfsPatch.bundle/files/lib/*.js payload/lib/
# Record the overlay version so the app does not re-apply (and downgrade) the
# same RootfsPatch files on first launch.
overlay_ver=$(/usr/libexec/PlistBuddy -c 'Print :version' "$ISH_SRC/app/RootfsPatch.bundle/manifest.plist")
mkdir -p payload/ish && printf '%s\n' "$overlay_ver" > payload/ish/overlay-version
cp -R "$ROOT/rootfs/overlay/." payload/
find payload -name '._*' -delete
# The harness config is canonical at the repo root (the same file the
# Linux and Termux setups install); place it in the guest image so the iOS
# app ships the identical config.
mkdir -p payload/root/.config/opencode
cp "$ROOT/../opencode.json" payload/root/.config/opencode/opencode.json
# Same for the starter skill (OpenCode's global skills source).
mkdir -p payload/root/.config/opencode/skills
cp -R "$ROOT/../skills/." payload/root/.config/opencode/skills/
# Same for the guard plugin (OpenCode's plugin discovery directory).
mkdir -p payload/root/.config/opencode/plugins
cp -R "$ROOT/../plugins/." payload/root/.config/opencode/plugins/
# Same for the delete-env action: the script on the guest PATH (guest
# Terminal) and the /delete-env command (web UI slash menu).
install -m 0755 "$ROOT/../scripts/delete-env.sh" payload/usr/local/bin/openmind-delete-env
mkdir -p payload/root/.config/opencode/command
cp "$ROOT/../commands/delete-env.md" payload/root/.config/opencode/command/delete-env.md
# Same for the custom endpoint: the script on the guest PATH (guest
# Terminal) and the /custom-endpoint command (web UI slash menu).
install -m 0755 "$ROOT/../scripts/set-custom-endpoint.sh" payload/usr/local/bin/openmind-set-custom-endpoint
cp "$ROOT/../commands/custom-endpoint.md" payload/root/.config/opencode/command/custom-endpoint.md
# Same for Antigravity: the loopback bridge (the antigravity provider in
# opencode.json points at it) and the Google sign-in script (guest Terminal).
# Node.js is installed in the guest image above (apk add nodejs).
install -m 0755 "$ROOT/../scripts/antigravity-bridge.mjs" payload/usr/local/bin/openmind-antigravity-bridge.mjs
install -m 0755 "$ROOT/../scripts/antigravity-login.mjs" payload/usr/local/bin/openmind-antigravity-login.mjs
# BSD tar otherwise serialises extended attributes as AppleDouble `._*` files
# when this payload is unpacked by the Linux guest.
COPYFILE_DISABLE=1 tar czf payload.tgz -C payload .
"$ISH_BUILD/ish" -f "$WORK/fakefs" /bin/sh -c 'cd / && tar xzf -' < payload.tgz 2>&1 | filter

log "Guest phase 3: verify opencode boots and serves"
# Part 1 — in-guest: binary runs, config resolves, models present.
ish <<'EOF'
set -e
export HOME=/root
chmod +x /usr/local/bin/opencode /usr/local/bin/openmind-serve /usr/local/bin/opencode-selftest
mkdir -p /root/workspace
opencode --version
node --version
python3 --version
opencode models | grep -q "openai/gpt-5"
opencode models | grep -q "experientiallabs/deepseek-v4.1-flash:free"
opencode models | grep -q "google/gemini-3.8-flash"
opencode models | grep -q "antigravity/gemini-3-flash"
echo "guest opencode: $(opencode --version), default + fallback + gemini + antigravity models present"
rm -rf /var/cache/apk/* /tmp/*
EOF

# Part 2 — boot the server in its own emulator session and probe it from the
# host loopback, the same pattern rootfs-test.sh uses for dsh-serve (and the
# same path the iOS app uses: WKWebView + readiness probe hit the forwarded
# loopback port). Probing from inside the guest does not work reliably in the
# CLI emulator — the first build failed here with HTTP 000 after ~35s even
# though the binary runs fine — so the host probe is authoritative.
PORT=4099
"$ISH_BUILD/ish" -f "$WORK/fakefs" /bin/sh -c "DSH_PORT=$PORT /usr/local/bin/openmind-serve" > "$WORK/openmind-serve.log" 2>&1 &
SERVER_ISH_PID=$!
stop_server() {
    kill "$SERVER_ISH_PID" 2>/dev/null || true
    pkill -f "$ISH_BUILD/ish -f $WORK/fakefs" 2>/dev/null || true
    wait "$SERVER_ISH_PID" 2>/dev/null || true
    sleep 1
}
up=0
for _ in $(seq 1 180); do
    sleep 1
    if curl -fs -o "$WORK/opencode-index.html" --max-time 3 "http://127.0.0.1:$PORT/"; then up=1; break; fi
done
echo "host probe of guest opencode web UI on :$PORT: up=$up"
if [ "$up" != 1 ]; then
    echo "--- openmind-serve.log ---"
    cat "$WORK/openmind-serve.log"
    stop_server
    die "guest opencode web UI did not answer on 127.0.0.1:$PORT within 180s"
fi
grep -Fq "<title>OpenMind Harness</title>" "$WORK/opencode-index.html"
stop_server
echo "guest opencode serves its web UI on 127.0.0.1:$PORT"

log "Export root.tar.gz"
rm -f "$OUT"
"$ISH_BUILD/tools/unfakefsify" fakefs "$OUT"
ls -lh "$OUT"
shasum -a 256 "$OUT" | tee "$OUT.sha256"

if [ "${1:-}" != "--keep-work" ]; then
    rm -rf opencode-bin stage payload payload.tgz
fi
log "Done: $OUT"
