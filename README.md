<p align="center">
  <img src="ios/app/DSHAssets.xcassets/DSHAppIcon.appiconset/icon-1024.png" width="96" alt="OpenMind Harness icon"><br>
  <strong>OpenMind Harness</strong><br>
  A universal coding-agent harness — OpenCode with one config for every provider, on every platform.
</p>

> OpenMind Harness is [OpenCode](https://opencode.ai) with a universal multi-provider config: one OpenAI-compatible interface that any provider plugs into. The default is ChatGPT (GPT-5, via your Plus subscription — no API credits needed); the working fallback is a free stock DeepSeek route. It runs the same everywhere — iOS app, Linux server, Android/Termux — with the same providers, the same default, the same fallback. Only the shell differs. No server, no account, no subscription — the harness and your keys live on your machine.

## The harness

OpenCode runs its standard agent loop (prompt → model → tools → execute → observe → repeat) with sessions, a config file, provider/model switching, and file and shell tools. Nothing about the agent itself is customized — the work here is the packaging, the universal provider config, and the OpenMind Harness branding. Full feature list: [docs/features.md](docs/features.md).

Two ways to run it on any platform:

- **`opencode web`** — the full web UI (default port **4097**). This is what the iOS app loads in its WKWebView and what the setup scripts launch.
- **`opencode serve`** — the API server only (default port **4096**), for headless use or driving it from another client.

Both bind `127.0.0.1` by default (this device only) and run with no password (`OPENCODE_SERVER_PASSWORD` is deliberately unset — the UI is only reachable from the device itself). To reach the UI from another device, set a password first and bind all interfaces: `OPENCODE_SERVER_PASSWORD='…' opencode web --hostname 0.0.0.0`. Never expose it without a password.

## Providers

Pick a provider in the web UI's model picker; add its key once per machine (see "Adding keys" below). Keys are never stored in the repo or the config file — they are read from environment variables, the web UI's `/connect` flow, or `opencode auth login`.

| Provider | Model | Key env var | Notes |
|---|---|---|---|
| OpenAI | `openai/gpt-5` | ChatGPT Plus/Pro OAuth or `OPENAI_API_KEY` | **Default.** ChatGPT models. With a Plus/Pro subscription, sign in via OAuth — no API credits needed. API-key use needs credits — an account with no credits returns `credit_balance_exhausted`. |
| Experiential Labs | `experientiallabs/deepseek-v4.1-flash:free` | `EXPLABS_API_KEY` | Free stock route; works out of the box as the fallback when OpenAI has no credits. |
| DeepSeek | catalog (`deepseek-flash`, `deepseek-v4-pro`, …) | `DEEPSEEK_API_KEY` | Stock DeepSeek API models. |
| Gemini | pinned (`gemini-3.8-flash`, `gemini-3.5-flash-lite`) | `GEMINI_API_KEY` | Google provider. `gemini-2.5-flash` is retired by Google — the config pins the working models. |
| Anthropic | catalog (`claude-sonnet-5`, `claude-haiku-5-5`, …) | `ANTHROPIC_API_KEY` | Claude models. |
| Groq | catalog (`openai/gpt-oss-120b`, …) | `GROQ_API_KEY` | Fast hosted models. |
| Mistral | catalog (`codestral-2508`, …) | `MISTRAL_API_KEY` | Mistral models. |
| xAI | catalog (`grok-4.6`, …) | `XAI_API_KEY` | Grok models. |
| Together | catalog (empty in 1.19.6 — see note) | `TOGETHER_API_KEY` | The 1.19.6 model catalog lists no Together models yet; the provider is configured and the picker shows models once the catalog updates or a `models` entry is added. |
| OrcaRouter | `orcarouter/z-ai/glm-5.3-flash-free` | `ORCAROUTER_API_KEY` | Free model, verified live. |
| OpenRouter | catalog (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, …) | `OPENROUTER_API_KEY` | OpenRouter's free models. |
| Antigravity | `antigravity/gemini-3-flash` | Google account OAuth (`openmind-antigravity-login`) | Google's agentic models (Gemini, Claude) through your Google account — no API key. Needs the loopback bridge (starts automatically in the iOS app; start it by hand on Linux/Termux). |
| APInex | pinned free (`free/deepseek-v4.1-flash`, `free/glm-5.3-flash`, `free/gemini-3.8-flash`, `free/gpt-6-luna`, `free/claude-sonnet-4.6`) | `APINEX_API_KEY` | Gateway: Claude, GPT, Gemini, DeepSeek, GLM, Qwen, Kimi, Grok on one key (22 free models listed live). **Needs a one-time $5 top-up to unlock the free tier** — until then every model call returns a billing error ("Make a single top-up of $5 or more to unlock 25M free tokens daily for life"). The key itself works (the model list answers); the account just has no usable free tokens yet. |
| Pollinations | `pollinations/gpt-oss-20b` | none (keyless) | Free, no signup, no key. One model (GPT-OSS 20B). **Direct endpoint verified live (answers), but the harness run stalls** — OpenCode produces no output and the call never starts, twice in a row. Not reliable as a harness provider; kept as a spare. Rate-limited to about one request per 45 seconds per IP. |
| GitHub Models | pinned (`openai/gpt-4.1`, `deepseek/DeepSeek-R1`, `meta/Meta-Llama-3.3-70B-Instruct`) | `GITHUB_TOKEN` (a GitHub personal access token) | Free for any GitHub user — no card. One endpoint, many model families (GPT, DeepSeek, Llama, Mistral, Phi). Needs a PAT; not yet tested live. |
| Ollama | local server discovery | none | Local models at `http://localhost:11434/v1`. |
| LM Studio | local server discovery | none | Local models at `http://localhost:1234/v1`. |
| Custom endpoint | your models | `OPENMIND_CUSTOM_BASE_URL` + `OPENMIND_CUSTOM_API_KEY` | Any OpenAI-compatible endpoint you supply. Set it with `openmind-set-custom-endpoint` (or `/custom-endpoint` in the web UI) — it asks for the URL, the bearer key and a model id, and saves them where the harness reads them. |

The default model is `openai/gpt-5` (top-level `"model"` in [`opencode.json`](opencode.json) — the single source of truth used on every platform). If OpenAI has no credits, switch to `experientiallabs/deepseek-v4.1-flash:free` in the model picker — that is the working out-of-the-box fallback. Small jobs (session titles and other one-line calls) always use the free fallback too (`"small_model"` in the config) — some providers' default small models are not on every key's access list, and a failed title call should never break a session.

## ChatGPT Plus — GPT-5 with no API credits

The default is GPT-5 because it works on a **ChatGPT Plus/Pro subscription** — no API credits needed. OpenCode's built-in OpenAI login signs in with your ChatGPT account over OAuth; requests then count against the subscription, not against API billing. (An OpenAI API key works too — export `OPENAI_API_KEY` — but with Plus you do not need one, and the config deliberately sets no API key for the OpenAI provider so the subscription login is used.)

```sh
opencode auth login --provider openai
```

Pick a method (verified in OpenCode 1.19.6):

| Method | How it works | Where to use it |
|---|---|---|
| `ChatGPT Pro/Plus (browser)` | Opens a browser; sign-in completes through a `localhost:1455` callback. | Linux, Termux (the phone browser shares Termux's localhost). |
| `ChatGPT Pro/Plus (headless)` | Device code — a short code to enter at `auth.openai.com/codex/device`. No browser needed where OpenCode runs. | **iPad guest (use this one)**, SSH, containers. |
| `Manually enter API Key` | API-key login (API billing, not the subscription). | Only if you want API billing instead of Plus. |

Login state is stored in `~/.local/share/opencode/auth.json` (mode `0600`).

**On the iPad**, use the app's Terminal (`>_` in the control bar) — the browser callback cannot reach the guest's loopback from iPad Safari, so the in-app web UI's `/connect` browser flow does not work for ChatGPT there. In the guest terminal run:

```sh
opencode auth login --provider openai --method "ChatGPT Pro/Plus (headless)"
```

Enter the shown code at `auth.openai.com/codex/device` in Safari. If the headless sign-in is refused by OpenAI's security checks, the reliable alternative is to sign in once on Linux or Termux (browser flow) and copy `~/.local/share/opencode/auth.json` into the guest at `/root/.local/share/opencode/auth.json` — same file, same login. Never paste the file's contents into chat; copy the file itself.

## Antigravity — Google account sign-in

Antigravity is Google's agentic platform (Cloud Code Assist): Gemini and Claude models through Google's Cloud infrastructure, billed against your Google account — no API key. The harness speaks to it through a small loopback bridge (`scripts/antigravity-bridge.mjs`), because Antigravity's API is its own format, not OpenAI-compatible. The bridge translates the harness's requests and back; it only ever runs on `127.0.0.1` on your own machine.

```sh
openmind-antigravity-login
```

Sign in with your Google account in the browser that opens (or with `--manual` on the iPad guest Terminal and headless machines: the script prints the sign-in URL, you paste back the redirect URL). Tokens are stored at `~/.config/opencode/antigravity-auth.json` (mode `0600`) — access token, refresh token, your email, and the Google Cloud project id the API needs. The bridge refreshes the token itself when it expires.

Start the bridge (the iOS app starts it automatically when the guest boots):

```sh
node ~/.local/bin/openmind-antigravity-bridge.mjs
```

Then pick `antigravity/gemini-3-flash` in the model picker. If you are not signed in, the model answers with a clear "not signed in" error — run the login script. Check sign-in state any time with `openmind-antigravity-login --status`, and refresh the token with `--refresh`. The `ANTIGRAVITY_API_KEY` env var in the config is only the loopback bridge's key — the real credential is the OAuth token file, never a key in the config.

## Onboarding — first run

1. Install on your platform (below).
2. Connect a provider: `opencode auth login --provider openai` (ChatGPT Plus/Pro) or export the provider's key (`EXPLABS_API_KEY`, …).
3. Test the connection: `opencode run --model experientiallabs/deepseek-v4.1-flash:free "Say only ok."` — a one-line answer proves the provider, the key, and the model ID all work.
4. Open the web UI (`opencode web`, http://127.0.0.1:4097) and pick a model. That is the whole setup; there is no account and no signup.

## Platforms — the same harness, three shells

| Platform | Shell | Setup |
|---|---|---|
| **iOS / iPadOS** | Native app (iSH-ARM64 guest + WKWebView) | Sideload the unsigned IPA from the repo's GitHub Actions (sign it yourself); the app boots the guest and loads the web UI. See "The iOS app" below. |
| **Linux** (Cosyra container, Oracle VM, any server) | Terminal / server | `bash linux-setup.sh` — installs the official Linux binary (1.19.6) to `~/.local/bin`, installs the config + skill + guard plugin, launches `opencode web` on http://127.0.0.1:4097. Falls back to `npm i -g opencode-ai` if the download fails. |
| **Android** (Termux) | Termux on the phone | `bash termux-setup.sh` — installs the native Android OpenCode build (guysoft/opencode-termux, 1.17.9 — see version note), installs the config + skill + guard plugin, launches `opencode web` on http://127.0.0.1:4097 (open it in the phone browser). No separate Android app. |

### Version notes

- iOS guest and Linux run OpenCode **1.19.6** (same release).
- Termux runs OpenCode **1.17.9** (guysoft/opencode-termux v0.2.1, the latest Android release as of 2026-11-21) — upstream publishes no Android binary, and its Linux glibc binary cannot run under Android's Bionic libc. Same config, slightly older engine. For the exact 1.19.6 build on the phone, use proot instead: `pkg install proot-distro && proot-distro install ubuntu`, then run `linux-setup.sh` inside the Ubuntu container.

### One config, everywhere

`opencode.json` is the single source of truth. The iOS guest image is built from this exact file (`ios/scripts/build-rootfs.sh` copies it into the guest), and both setup scripts install this exact file to `~/.config/opencode/`. Edit it in one place and every platform picks it up on its next install or rebuild. No per-platform config differences: same providers, same model IDs, same defaults, same agents.

## Adding keys

Keys go in the machine, not in the repo. Three ways:

1. **ChatGPT Plus/Pro** — `opencode auth login --provider openai` (see above).
2. **Web UI** — open the model picker in the OpenCode UI and connect a provider there (the `/connect` flow).
3. **Environment** — export the variable in your shell, e.g. `export EXPLABS_API_KEY=…`, or in the iOS app's Terminal (`>_` in the control bar) in the guest shell, then restart the server from the `⋯` menu.

## The iOS app

The iOS/iPadOS app is one packaging of the harness: a native shell (iSH-ARM64 emulator + Alpine 3.21 guest + WKWebView) that boots the same OpenCode and loads the same web UI. It behaves on iPad exactly like on iPhone — same boot flow, same guest, same web UI, all four iPad orientations.

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

### Install

The unsigned IPA is built by GitHub Actions (`.github/workflows/build-ipa.yml`, `CODE_SIGNING_ALLOWED=NO`). Sign it with your own Apple ID / developer certificate and sideload it (AltStore, Sideloadly, or Xcode) — no signing material is shipped in the repo.

### Test it on your iPad

First launch imports the guest image (about a minute on first boot, then
seconds). Work through these in order; what success looks like is in
brackets.

1. **Install** — sign the IPA with your Apple ID and sideload it. Open the
   app. [The app opens; a progress overlay shows the guest starting.]
2. **First boot** — wait for the overlay to clear and the OpenCode web UI
   to appear. [The status dot reads `ready` and the chat input is visible.]
3. **Sign in with ChatGPT Plus** — open the Terminal (`>_` in the control
   bar) and run `opencode auth login --provider openai --method "ChatGPT Pro/Plus (headless)"`.
   Enter the shown code at `auth.openai.com/codex/device` in Safari.
   [The terminal reports the login succeeded; no key was typed anywhere.]
4. **First prompt** — in the web UI, type `Say only the word ok.` and send.
   [GPT-5 answers `ok` — that is your Plus subscription answering, not API billing.]
5. **Switch provider mid-session** — open the model picker (top of the UI),
   switch to `experientiallabs/deepseek-v4.1-flash:free`, and ask a
   follow-up in the same session. [The free fallback answers and the
   earlier GPT-5 exchange is still in the session — memory intact.]
6. **Switch model back** — pick `openai/gpt-5` again in the same session
   and ask another question. [GPT-5 answers; the session still holds the
   whole conversation.]
7. **Plan mode** — switch the agent to `plan` and ask it to plan a small
   change before editing. [It explores and writes a plan without editing
   files.]
8. **Sub-agent** — ask the primary agent to use the reviewer subagent on
   your current changes. [A read-only review comes back; nothing is edited.]
9. **Sessions** — leave the app, reopen it, and check the session list.
   [Your session is still there and resumes.]
10. **Rotate the iPad** — turn it to landscape and back, including upside
    down. [The layout follows all four orientations.]

If a step fails, note the exact step and what you saw (a screenshot of the
overlay or the Terminal output helps); the app's Log screen (`≡` menu)
holds the guest and server logs.

### Delete saved env (free up space)

Keys, sessions, and caches accumulate on the device. One action clears
them:

- **In the app:** open the web UI and type `/delete-env` in the chat, or
  open the Terminal (`>_`) and run `openmind-delete-env`.
- **On Linux / Termux:** run `openmind-delete-env` (add `--yes` to skip
  the prompt).
- **What it removes:** stored credentials (ChatGPT Plus OAuth tokens and
  any API keys saved through the UI), sessions (unless `--keep-sessions`),
  logs, the guard audit log, stale server locks, and the model catalog
  cache. It reports what was removed and roughly how much space was freed
  (keys removed are named, never shown). Key exports in shell rc files
  are reported, and stripped only with `--purge-rc`.
- **What it does NOT remove:** the provider config, skills, plugins,
  commands, your files/workspace, or the guest image.
- **Afterwards:** the harness starts cleanly, exactly as if freshly
  installed — it just asks you to sign in or enter keys again. Deleting
  env cannot break the install, the guest, or the app. Stop the server
  first (the script refuses while one is running).

### Build it yourself

```sh
git clone https://github.com/tjcrims0nx/openmind-harness.git && cd openmind-harness
make -C ios rootfs       # ios/build/root.tar.gz — Alpine + OpenCode (~90 MB, ~6 min, needs network)
open ios/DSH.xcodeproj   # DSH scheme → your iPad → set the team → Run
```

`make -C ios test` runs the emulator, rootfs, and simulator test suites. The guest image is built reproducibly by `ios/scripts/build-rootfs.sh` from the Alpine 3.21 aarch64 repositories and the pinned OpenCode release.

## Eval

`eval/` holds a small task set (breadth tasks plus an exec-verified hard subset) and a runner that grades by running the model's actual artifact, so a stub fails. `bash eval/run.sh`. A live run needs a signed-in provider or a key. See `eval/README.md`.

## License

OpenMind Harness is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)), because it compiles and statically links the [iSH](https://github.com/ish-app/ish) / [iSH-ARM64](https://github.com/OpenMinis/ish-arm64) emulator, which is GPLv3 with the additional App Store terms in [`ios/ish-arm64/LICENSE.IOS`](ios/ish-arm64/LICENSE.IOS). Those additional terms apply to OpenMind Harness as well. See [LICENSE.md](LICENSE.md) for the third-party component list.
