# Install — OpenMind Harness

One command per platform. Each installs OpenCode + the universal config
(`opencode.json`, default `google/gemini-3.5-flash-lite`) + the starter
skill + the guard plugin + the OMH runtime/MCP bridge, then launches the
web UI on http://127.0.0.1:4097. No account, no signup, no keys stored
by the installer — add keys with `opencode auth login` or in the web UI.

## Linux (server, container, VM)

```bash
curl -fsSL https://raw.githubusercontent.com/tjcrims0nx/openmind-harness/main/linux-setup.sh -o linux-setup.sh
bash linux-setup.sh
```

Or from a clone: `bash linux-setup.sh [--no-launch]`. Installs the
official OpenCode 1.19.6 Linux binary to `~/.local/bin` (falls back to
`npm i -g opencode-ai` if the download fails).

## macOS (Apple Silicon or Intel)

```bash
curl -fsSL https://raw.githubusercontent.com/tjcrims0nx/openmind-harness/main/macos-setup.sh -o macos-setup.sh
bash macos-setup.sh
```

Or from a clone: `./macos-setup.sh [--no-launch]`. Installs the
official OpenCode 1.19.6 macOS binary to `~/.local/bin`, clears the
Gatekeeper quarantine flag, and adds `~/.local/bin` to your PATH in
`~/.zshrc` / `~/.bash_profile`. Node.js 22+ is installed on demand
(Homebrew, else the official tarball) for the OMH runtime/MCP bridge.

## Windows (PowerShell, x64 or ARM64)

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/tjcrims0nx/openmind-harness/main/windows-setup.ps1 -OutFile windows-setup.ps1
.\windows-setup.ps1
```

Or from a clone: `.\windows-setup.ps1 [-NoLaunch]`. Installs the
official OpenCode 1.19.6 Windows binary to
`%LOCALAPPDATA%\Programs\opencode` and adds it to your user PATH.
Node.js 22+ is installed on demand (winget, else the official zip)
for the OMH runtime/MCP bridge. If PowerShell blocks the script
because it came from the internet, unblock that one file first:
`Unblock-File .\windows-setup.ps1`.
The `delete-env` and `custom-endpoint` helpers are bash scripts — on
Windows they run from Git Bash, not PowerShell.

## Android (Termux on the phone)

```bash
pkg update && pkg install -y git curl
git clone https://github.com/tjcrims0nx/openmind-harness.git
bash openmind-harness/termux-setup.sh [--no-launch]
```

Installs the native Android OpenCode build (guysoft/opencode-termux,
1.17.9 — upstream publishes no Android binary) + the same config.
Open the web UI in the phone browser at http://127.0.0.1:4097.
Run `termux-wake-lock` first so the phone does not kill Termux mid-run.

## iOS / iPadOS

Separate native app, own repo: [tjcrims0nx/omh-iOS](https://github.com/tjcrims0nx/omh-iOS).
GitHub Actions publishes an unsigned IPA that requires signing.

## After install

1. Connect a provider: `opencode auth login --provider openai`
   (ChatGPT Plus/Pro) or export the provider's key (`EXPLABS_API_KEY`, …).
2. Test it: `opencode run --model experientiallabs/deepseek-v4.1-flash:free "Say only ok."`
3. Open the web UI (`opencode web`, http://127.0.0.1:4097) and pick a model.

To update an existing install, copy the latest `opencode.json` to your
OpenCode config directory or rerun the platform setup, and start a **new
session**. The iOS guest image is built from a pinned revision of this
repo; changes here reach the app only when that pin is updated.

## Version notes

- iOS guest, Linux, macOS and Windows run OpenCode **1.19.6** (same release).
- Termux runs OpenCode **1.17.9** (guysoft/opencode-termux v0.2.1, the
  latest Android release as of 2026-11-21) — upstream publishes no
  Android binary, and its Linux glibc binary cannot run under Android's
  Bionic libc. Same config, slightly older engine. For the exact 1.19.6
  build on the phone, use proot instead:
  `pkg install proot-distro && proot-distro install ubuntu`, then run
  `linux-setup.sh` inside the Ubuntu container.
