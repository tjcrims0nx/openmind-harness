<p align="center">
  <img src="app/DSHAssets.xcassets/DSHAppIcon.appiconset/icon-1024.png" width="96" alt="OpenMind Harness icon"><br>
  <strong>OpenMind Harness</strong><br>
  A universal coding-agent harness for iPhone and iPad — OpenCode running in an on-device Linux guest.
</p>

> OpenMind Harness is a native iOS app that runs [OpenCode](https://opencode.ai) inside an Alpine Linux guest (iSH-ARM64 emulator) and shows its web UI in a WKWebView. One universal OpenAI-compatible API interface: point it at any provider below and switch between them from the web UI's model picker. No server, no account, no subscription — the harness and your keys live on your device.

## Providers

OpenCode is configured with a multi-provider setup. Pick a provider in the web UI's model picker; add its key once the app is running (see "Adding keys" below). Keys are never stored in the repo or the config file — they are read from environment variables in the guest.

| Provider | Model | Key env var | Notes |
|---|---|---|---|
| OpenAI | `openai/gpt-5` | `OPENAI_API_KEY` | **Default.** ChatGPT models. Your OpenAI account needs credits — an account with no credits returns `credit_balance_exhausted`. |
| Experiential Labs | `experientiallabs/deepseek-v4.1-flash:free` | `EXPLABS_API_KEY` | Free stock route; works out of the box as the fallback when OpenAI has no credits. |
| DeepSeek | catalog (`deepseek-flash`, `deepseek-v4-pro`, …) | `DEEPSEEK_API_KEY` | Stock DeepSeek API models. |
| Gemini | catalog (`gemini-2.5-flash`, `gemini-3.5-flash-lite`, …) | `GEMINI_API_KEY` | Google provider. |
| OrcaRouter | `orcarouter/z-ai/glm-5.3-flash-free` | `ORCAROUTER_API_KEY` | Free model, verified live. |
| OpenRouter | catalog (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, …) | `OPENROUTER_API_KEY` | OpenRouter's free models. |

The default model is `openai/gpt-5` (top-level `"model"` in `rootfs/overlay/root/.config/opencode/opencode.json`). If OpenAI has no credits, switch to `experientiallabs/deepseek-v4.1-flash:free` in the model picker — that is the working out-of-the-box fallback.

## Adding keys

Keys go in the guest, not in the repo. Two ways:

1. **Web UI** — open the model picker in the OpenCode UI and connect a provider there (the `/connect` flow).
2. **Guest environment** — in the app's Terminal (`>_` in the control bar), set the variable in the guest shell, e.g. `export OPENAI_API_KEY=sk-…`, then restart the server from the `⋯` menu. The variable is read from the guest environment by `opencode-serve` on startup.

## How it works

```
┌─ OpenMind Harness ───────────────────────────────────────────────────┐
│  RootViewController ──► WKWebView ──► http://127.0.0.1:<port>        │
│  Harness supervisor (port pick · readiness probe · restart · health)  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  iSH-ARM64 emulator ──► Alpine 3.21 guest                      │  │
│  │    /usr/local/bin/opencode-serve                               │  │
│  │      → opencode serve --hostname 127.0.0.1 --port $DSH_PORT    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

- **The app** picks a free loopback port, launches `opencode-serve` in the guest, probes the server until it answers (ready when the HTTP status is < 500), and loads the OpenCode web UI in the WKWebView. The server is loopback-only and runs with no password (`OPENCODE_SERVER_PASSWORD` is deliberately unset — the UI is only reachable from inside the app).
- **The guest** is Alpine 3.21 arm64 with OpenCode 1.19.6 (musl arm64 binary, no Node needed). Your workspace lives in `/root/workspace` in the guest; session data in `/root/.config/opencode`.
- **iPad:** the app is universal (iPhone + iPad, all four iPad orientations) and behaves the same on iPad as on iPhone — same boot flow, same guest, same web UI.

## Install

The unsigned IPA is built by GitHub Actions (`.github/workflows/build-ipa.yml`, `CODE_SIGNING_ALLOWED=NO`). Sign it with your own Apple ID / developer certificate and sideload it (AltStore, Sideloadly, or Xcode) — no signing material is shipped in the repo.

## Build it yourself

```sh
git clone https://github.com/tjcrims0nx/openmind-harness-ios.git && cd openmind-harness-ios
make rootfs          # build/root.tar.gz — Alpine + OpenCode (~85 MB, ~6 min, needs network)
open DSH.xcodeproj   # DSH scheme → your iPad → set the team → Run
```

`make test` runs the emulator, rootfs, and simulator test suites. The guest image is built reproducibly by `scripts/build-rootfs.sh` from the Alpine 3.21 aarch64 repositories and the pinned OpenCode release.

## License

OpenMind Harness is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)), because it compiles and statically links the [iSH](https://github.com/ish-app/ish) / [iSH-ARM64](https://github.com/OpenMinis/ish-arm64) emulator, which is GPLv3 with the additional App Store terms in [`ish-arm64/LICENSE.IOS`](ish-arm64/LICENSE.IOS). Those additional terms apply to OpenMind Harness as well. See [LICENSE.md](LICENSE.md) for the third-party component list.
