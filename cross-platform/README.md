# OpenMind Harness — everywhere

The harness is **OpenCode** with one universal multi-provider config
([`opencode.json`](opencode.json)). It is the same harness on every platform —
same providers, same ChatGPT-primary default, same free fallback. Only the
shell around it differs.

## The harness (standard behavior)

OpenCode is a typical coding-agent harness, used with its defaults — nothing
about the agent itself is customized here. The normal loop runs everywhere:

**prompt → model → tools → execute → observe → repeat**, with persistent
sessions, a config file, provider/model switching in the web UI, and the
standard file and shell tools. The custom work in this repo is the packaging
(iOS app, Linux setup, Termux setup), the universal provider config, and the
OpenMind Harness branding — not a new agent design.

| | Default model | Free fallback |
|---|---|---|
| Everywhere | `openai/gpt-5` (OpenAI / ChatGPT) | `experientiallabs/deepseek-v4.1-flash:free` |

Your OpenAI account needs credits — an account with no credits returns
`credit_balance_exhausted`. When that happens, switch to the free fallback in
the model picker; it works out of the box with only `EXPLABS_API_KEY` set.

## Providers (switchable in the web UI's model picker)

| Provider | Model | Key env var |
|---|---|---|
| OpenAI | `openai/gpt-5` | `OPENAI_API_KEY` |
| Experiential Labs | `experientiallabs/deepseek-v4.1-flash:free` | `EXPLABS_API_KEY` |
| DeepSeek | catalog (`deepseek-flash`, `deepseek-v4-pro`, …) | `DEEPSEEK_API_KEY` |
| Gemini | catalog (`gemini-2.5-flash`, `gemini-3.5-flash-lite`, …) | `GEMINI_API_KEY` |
| OrcaRouter | `orcarouter/z-ai/glm-5.3-flash-free` (verified live), `orcarouter/tencent/hy3-free`, `orcarouter/tencent/hy4-preview-free` (listed-free) | `ORCAROUTER_API_KEY` |
| OpenRouter | catalog (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, …) | `OPENROUTER_API_KEY` |

Keys are never baked into the repo or the config — they come from environment
variables, or from the web UI's `/connect` flow. Add a key once per machine;
the same config file works on all of them.

## Task-routed agents (same config)

The config defines two extra agents on top of OpenCode's built-in `build`
(default) and `plan`. They route work by job, the way a router picks a model
per subtask — each just sets a model and a role; the agent behavior stays stock.

| Agent | Model | When to use |
|---|---|---|
| `build` (default) | `openai/gpt-5` | Normal coding work. |
| `fast` | `experientiallabs/deepseek-v4.1-flash:free` | Small jobs — quick questions, small edits, summaries. Free. |
| `reviewer` (subagent) | `openai/gpt-5` | Read-only review of current changes. Ask the primary agent: "Use the reviewer subagent to review my current changes." |

## Skills

Agent Skills (the `SKILL.md` standard) work in OpenCode out of the box. This
repo ships one starter skill, [`skills/openmind-harness/SKILL.md`](../skills/openmind-harness/SKILL.md),
which teaches the agent the providers, the model switching, and the free
fallback. The setup scripts install it to `~/.config/opencode/skills/`
(OpenCode's global skills source); the iOS guest image ships it too. The model
discovers it by its description and loads it with the `skill` tool; you can
also invoke it directly as `@openmind-harness` in a prompt.

Third-party skills install the same way (`npx skills add <owner>/<repo>` works
in any harness that supports Agent Skills, OpenCode included) — drop the
resulting `SKILL.md` into `~/.config/opencode/skills/` (global) or
`.opencode/skills/` (per project).

## Run it

| Platform | Shell | Setup |
|---|---|---|
| **iOS / iPadOS** | Native app (iSH-ARM64 guest + WKWebView) | Sideload the unsigned IPA from the repo's GitHub Actions (sign it yourself); the app boots the guest and loads the web UI. See the main README. |
| **Linux** (Cosyra container, Oracle VM, any server) | Terminal / server | `bash cross-platform/linux-setup.sh` — installs the official Linux binary (1.19.6) to `~/.local/bin`, installs the config + skill, launches `opencode web` on http://127.0.0.1:4097. Falls back to `npm i -g opencode-ai` if the download fails. |
| **Android** (Termux) | Termux on the phone | `bash cross-platform/termux-setup.sh` — installs the native Android OpenCode build (guysoft/opencode-termux, 1.17.9 — see version note), installs the config + skill, launches `opencode web` on http://127.0.0.1:4097 (open it in the phone browser). No separate Android app. |

Two ways to run the harness on any of these:

- **`opencode web`** — the full web UI (default port **4097**). This is what the
  iOS app loads in its WKWebView and what the setup scripts launch.
- **`opencode serve`** — the API server only (default port **4096**), for
  headless use or driving it from another client.

Both bind `127.0.0.1` by default (this device only) and run with no password
(`OPENCODE_SERVER_PASSWORD` is deliberately unset — the UI is only reachable
from the device itself). To reach the UI from another device, set a password
first and bind all interfaces: `OPENCODE_SERVER_PASSWORD='…' opencode web
--hostname 0.0.0.0`. Never expose it without a password.

### Version notes

- iOS guest and Linux run OpenCode **1.19.6** (same release).
- Termux runs OpenCode **1.17.9** (guysoft/opencode-termux v0.2.1, the latest
  Android release as of 2026-11-21) — upstream publishes no Android binary,
  and its Linux glibc binary cannot run under Android's Bionic libc. Same
  config, slightly older engine. For the exact 1.19.6 build on the phone,
  use proot instead: `pkg install proot-distro && proot-distro install ubuntu`,
  then run `cross-platform/linux-setup.sh` inside the Ubuntu container.

## ChatGPT Plus — GPT-5 with no API credits

The default model is GPT-5, and it works on a ChatGPT Plus/Pro subscription
— no API credits needed. OpenCode's built-in OpenAI login signs in with your
ChatGPT account over OAuth; requests then count against the subscription, not
against API billing. (An OpenAI API key works too — export `OPENAI_API_KEY`
— but with Plus you do not need one, and the config deliberately sets no API
key for the OpenAI provider so the subscription login is used.)

```sh
opencode auth login --provider openai
```

Pick a method (verified in OpenCode 1.19.6):

| Method | How it works | Where to use it |
|---|---|---|
| `ChatGPT Pro/Plus (browser)` | Opens a browser; sign-in completes through a `localhost:1455` callback. | Linux, Termux (the phone browser shares Termux's localhost). |
| `ChatGPT Pro/Plus (headless)` | Device code — a short code to enter at `auth.openai.com/codex/device`. No browser needed where OpenCode runs. | iPad guest (in the app's Terminal), SSH, containers. |
| `Manually enter API Key` | API-key login (API billing, not the subscription). | Only if you want API billing instead of Plus. |

Login state is stored in `~/.local/share/opencode/auth.json` (mode `0600`).
To move a login between platforms, copy that one file (never paste its
contents into chat). In the iPad guest the file lives at
`/root/.local/share/opencode/auth.json`.

If the headless sign-in is refused by OpenAI's security checks, sign in once
on Linux or Termux (browser flow) and copy `auth.json` into the guest — the
most reliable path.

## MCP servers (optional, not enabled by default)

OpenCode takes MCP servers in the same config file, Hermes-style. Nothing is
enabled by default (no extra services, no keys). To add one, merge a block
like this into `opencode.json` (example only — replace with a server you
actually use):

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "some-mcp-server"],
      "environment": { "MY_SERVER_KEY": "{env:MY_SERVER_KEY}" }
    }
  }
}
```

## One config, everywhere

`opencode.json` is the single source of truth. The iOS guest image is built
from this exact file (`scripts/build-rootfs.sh` copies it into the guest),
and both setup scripts install this exact file to `~/.config/opencode/`.
Edit it in one place and every platform picks it up on its next install or
rebuild. No per-platform config differences: same providers, same model IDs,
same defaults, same agents.
