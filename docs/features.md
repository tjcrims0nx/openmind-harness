# OpenMind Harness — features

What the harness does, in its own terms. Everything below is part of the
shipped config, the guard plugin, the setup scripts, or the stock OpenCode
behavior the harness is built on. No feature here depends on any other
project.

## Providers — one config, sixteen providers

`opencode.json` declares sixteen providers. The default model is
`openai/gpt-5`; the working out-of-the-box fallback is
`experientiallabs/deepseek-v4.1-flash:free`. Switch in the web UI's model
picker or with the model flag — no restart, no config edit. Small jobs
(session titles and other one-line calls) always use the free fallback
(`"small_model"` in the config), because some providers' default small
models are not on every key's access list.

| Provider | Key | Notes |
|---|---|---|
| OpenAI (default) | ChatGPT Plus/Pro OAuth (`opencode auth login --provider openai`) or `OPENAI_API_KEY` | Default `openai/gpt-5`. With a Plus/Pro subscription, requests count against the subscription, not API billing. |
| Experiential Labs (free fallback) | `EXPLABS_API_KEY` | `deepseek-v4.1-flash:free` — free stock route. |
| DeepSeek | `DEEPSEEK_API_KEY` | Stock DeepSeek API models. |
| Gemini | `GEMINI_API_KEY` | Google provider. Models pinned in the config: `gemini-3.8-flash`, `gemini-3.5-flash-lite` (`gemini-2.5-flash` is retired by Google). |
| Antigravity | Google account OAuth (`openmind-antigravity-login`) | Google's agentic models (Gemini, Claude) through your Google account — no API key. The harness talks to Antigravity through the loopback bridge (`scripts/antigravity-bridge.mjs`, 127.0.0.1:18080); sign in once and the bridge uses the stored OAuth tokens. |
| Anthropic | `ANTHROPIC_API_KEY` | Claude models. |
| Groq | `GROQ_API_KEY` | Fast hosted models. |
| Mistral | `MISTRAL_API_KEY` | Mistral models. |
| xAI | `XAI_API_KEY` | Grok models. |
| Together | `TOGETHER_API_KEY` | Together models. The 1.19.6 model catalog lists no Together models yet, so the picker shows none until the catalog updates or a `models` entry is added. |
| OrcaRouter | `ORCAROUTER_API_KEY` | Gateway; free models pinned (`z-ai/glm-5.3-flash-free` verified live, `tencent/hy3-free`, `tencent/hy4-preview-free`). |
| OpenRouter | `OPENROUTER_API_KEY` | Gateway; free models pinned (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`). |
| APInex | `APINEX_API_KEY` | Gateway; free models pinned (`free/deepseek-v4.1-flash`, `free/glm-5.3-flash`, `free/gemini-3.8-flash`, `free/gpt-6-luna`, `free/claude-sonnet-4.6`). Key verified live (the model list answers, 44 models). **Needs a one-time $5 top-up to unlock the free tier** — until then model calls return a billing error, not a config error. |
| Ollama | none | Local models at `http://localhost:11434/v1`. Models appear when the Ollama server runs. |
| LM Studio | none | Local models at `http://localhost:1234/v1`. Models appear when LM Studio runs. |
| Custom endpoint | `OPENMIND_CUSTOM_BASE_URL` + `OPENMIND_CUSTOM_API_KEY` | Any OpenAI-compatible endpoint you supply. No models until the endpoint is set. |

Keys are never in the repo or the config file — environment variables, the
web UI's `/connect` flow, or `opencode auth login` only.

## Antigravity — Google account sign-in

Antigravity (Google Cloud Code Assist) is a provider like the others, with
one difference: it has no API key. You sign in with your Google account
(OAuth 2.0 + PKCE), and requests count against that account's Antigravity
quota. The harness reaches it through the bridge:

- Sign in: `openmind-antigravity-login` (or `node scripts/antigravity-login.mjs`).
  Auto mode opens the Google sign-in in your browser with a local callback;
  `--manual` prints the URL and you paste back the redirect — use that in
  the iPad guest Terminal and on headless machines, where the browser cannot
  reach the local callback. Tokens land at
  `~/.config/opencode/antigravity-auth.json` (mode 0600): access token,
  refresh token, expiry, email, Google Cloud project id, and the models
  your account can use.
- Bridge: `node scripts/antigravity-bridge.mjs` (loopback only,
  127.0.0.1:18080). It translates the harness's OpenAI-compatible requests
  into Antigravity's API format and streams the answers back. The iOS app
  starts it automatically when the guest boots; on Linux/Termux start it by
  hand. It refreshes an expired access token itself.
- Use: pick `antigravity/gemini-3-flash` in the model picker. Not signed in
  yet? The model answers with a clear "not signed in" error — run the login
  script. `--status` shows the sign-in state (no secrets); `--refresh`
  refreshes the token.
- The `ANTIGRAVITY_API_KEY` env var in the config is only the loopback
  bridge's key. The real credential is the OAuth token file.

## Onboarding — first run

1. Install (Linux: `bash linux-setup.sh`; Termux: `bash termux-setup.sh`;
   iOS: sideload the IPA and open the app).
2. Connect a provider: `opencode auth login --provider openai` (ChatGPT
   Plus/Pro) or export the provider's key (`EXPLABS_API_KEY`, …).
3. Test the connection: `opencode run --model
   experientiallabs/deepseek-v4.1-flash:free "Say only ok."` — a one-line
   answer proves the provider, the key, and the model ID all work.
4. Open the web UI (`opencode web`, http://127.0.0.1:4097) and pick a
   model. That is the whole setup; there is no account and no signup.

## Mid-session model switching — memory intact

Switch provider or model in the middle of a session from the model picker.
The session — conversation, files, and context — stays where it is; only
the model behind the next turn changes. Sessions are stored in
`~/.local/share/opencode/` (SQLite) and survive restarts.

## Plan mode

The `plan` agent explores and plans before touching code: it reads, searches,
and writes a plan, and cannot edit files. Switch to it from the agent
switcher when you want a plan first; switch back to `build` to execute it.

## Tool suite

The standard loop is prompt → model → tools → execute → observe → repeat.
Tools: read, write, edit, grep, glob, bash (including background shells),
web fetch, web search, todo lists, and the task tool for sub-agents. Nothing
exotic; the agent uses the tools OpenCode ships.

## Sub-agents

`task` spawns an isolated-context sub-agent for a piece of work. Two are
pinned in the config: `fast` (small jobs on the free fallback model) and
`reviewer` (read-only review subagent on `openai/gpt-5`, edit and shell
denied). Built-ins `explore` and `general` are available too. Sub-agents
can work in their own git worktree (`worktree` config).

## MCP servers

MCP servers plug into the same config file (`"mcp"` block, stdio or HTTP);
their tools register into the agent loop automatically. None is enabled by
default. See `README.md` for the pattern.

## Skills

Skills are `SKILL.md` files with progressive disclosure: the agent reads
the description first and the full skill only when it applies. The starter
skill `skills/openmind-harness/SKILL.md` documents the providers, the
Plus login, and the task-routed agents; the setup scripts and the iOS guest
image install it to `~/.config/opencode/skills/`. More skills install the
same way (`npx skills add …`).

## Hooks — the guard plugin

`plugins/openmind-guard/` is a small plugin that hooks tool calls:

- **Before a tool runs** it denies three things by throwing (which aborts
  the call): catastrophic shell commands (`rm -rf /`, `mkfs`, `dd` to a
  device, fork bombs, `chmod`/`chown -R` on `/`, shutdown/reboot), web
  fetches to non-http(s) schemes or loopback/private/link-local/metadata
  hosts, and reads/edits/writes of credential files (`auth.json`, `~/.ssh`,
  `~/.gnupg`, `*.pem`/`*.p12`/`*.mobileprovision`).
- **After a tool runs** it appends one JSON line per call to
  `~/.local/share/opencode/openmind-guard.log` (append-only; anything that
  looks like a secret is redacted first). Logging never breaks a call.

Limits, stated plainly: the plugin hooks the primary agent's native tool
calls. It does not fire for MCP tool calls or for calls inside
task-spawned subagents (an upstream OpenCode 1.x limitation), and commands
typed directly with `!` in the TUI bypass plugins. Those paths are covered
by the `permission` map instead. The plugin's decision logic is unit-tested
(`node` harness, 18 cases); a live denial needs a working model call.

**Activation:** OpenCode 1.19.6 (V1) does not load local plugins — the
`plugins` config key is a V2 setting (the V1 binary logs it as omitted)
and the V1 discovery directories did not load the plugin in probe tests
(a module that throws on import produced no error and a clean start).
The plugin ships in the repo and is installed to the discovery directory
by the setup scripts and the iOS guest image, so it activates as soon as
the harness moves to OpenCode 2.x, with no change needed. Until then the
guard is present but dormant; the `permission` map is the live layer.

## Durable memory

- Sessions persist (SQLite) and resume; the web UI lists them.
- Snapshots enable undo/revert of edits.
- `experimental.home_memory` is enabled in the config: OpenCode keeps a
  persistent memory across sessions (experimental flag, verified to start
  clean on 1.19.6).
- `AGENTS.md` in a project is the persistent project memory the agent
  reads every session.
- Sessions can be shared/exported from the UI.

## Autonomy levels

Four levels, expressed as `permission` rules (allow / ask / deny per tool)
in the config — the user picks one by editing the `permission` block, or
with the script (needs python3; Linux / Termux / macOS):

```sh
bash scripts/set-autonomy.sh <manual|auto-read|auto-edit|full> [config-path]
```

The script writes a backup (`opencode.json.bak`), sets the map, and prints
it. Restart OpenCode (or the iOS app) for it to take effect. The level
applies to the primary agent; the `reviewer` agent stays read-only
regardless.

| Level | Reads | Edits | Shell | Web |
|---|---|---|---|---|
| manual | ask | ask | ask | ask |
| auto-read | allow | ask | ask | allow |
| auto-edit | allow | allow | ask | allow |
| full | allow | allow | allow | allow |

The shipped default is OpenCode's own (allow, with ask for outside-the-
workspace paths and for `.env` reads). The `reviewer` agent is pinned to
read-only regardless of level. The guard plugin's catastrophic-command
denylist always applies (once active) — it is not bypassed by the level.

## Security boundaries — on by default

- **Workspace jail:** paths outside the workspace ask first (native
  `external_directory` permission); the iOS guest is itself a jailed
  Linux system.
- **Secret hygiene:** keys come from env vars or the credential store
  only; the config never holds one; the guard log redacts key-like values;
  the iOS app's log buffer redacts all six provider keys plus
  `Authorization: Bearer`.
- **SSRF guard:** the guard plugin denies web fetches to loopback,
  private, link-local, and cloud-metadata hosts.
- **Loopback-only serving:** `opencode serve` / `opencode web` bind
  `127.0.0.1` with no password by design (only this device can reach the
  UI). To expose it, set `OPENCODE_SERVER_PASSWORD` first.
- **Zero telemetry:** no analytics, no crash reporting, no phone-home.
  The only outbound traffic is the provider API calls and the web tools
  the agent explicitly invokes.
- **No `--yolo` equivalent ships:** there is no flag in this harness that
  turns the guard off globally. Disable the plugin in the config if you
  need a call it blocks, and re-enable it after.

## Delete saved env — free up space

When keys, sessions, and caches pile up, delete them in one action
instead of hunting through directories:

- **Web UI:** type `/delete-env` in the chat. The agent runs the cleanup
  and reports what was removed and how much space was freed.
- **Terminal (Linux, Termux, or the app's guest Terminal):**
  `openmind-delete-env` (add `--yes` to skip the prompt).
- **What it removes:** stored credentials (`auth.json` — ChatGPT Plus
  OAuth tokens and any API keys saved through the UI), sessions
  (`opencode.db*`, unless `--keep-sessions`), logs, the guard audit log,
  stale server locks, the model catalog cache, and `~/.config/opencode/.env`
  if one exists. Shell rc key exports are reported, and stripped only
  with `--purge-rc` (a `.bak` copy is kept).
- **What it does NOT remove:** `opencode.json`, skills, plugins, commands,
  the workspace, the binary, or the guest image.
- **Afterwards:** the harness is exactly as if freshly installed — it
  starts cleanly and just asks you to sign in or enter keys again. It
  refuses to run while a server is running (stop the server first, or
  pass `--force`).

## Custom endpoints — local models

Ollama and LM Studio connect with a base URL only, no key. Any other
OpenAI-compatible endpoint works through the `custom` provider
(`OPENMIND_CUSTOM_BASE_URL` + `OPENMIND_CUSTOM_API_KEY`). The harness
speaks the Anthropic and OpenAI wire formats through the built-in
providers, and recovers tool calls a model emits as plain text.

## Eval — how the harness is measured

`eval/` holds a small task set (breadth tasks plus an exec-verified hard
subset) and a runner that grades by running the model's actual artifact,
so a stub fails. Run it with a working provider:

```sh
bash eval/run.sh
```

A full live eval run needs a signed-in provider or a key; the runner's
mechanics (invoke, capture, grade) are validated without one, and the
task set is verified solvable. See `eval/README.md`.
