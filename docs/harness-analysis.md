# Harness analysis — Hermes, OrcaRouter, DeepSeek dsh

Compared 2026-11-21 to decide what OpenMind Harness should copy. OpenMind
Harness is OpenCode 1.19.6 + one universal multi-provider config
(`cross-platform/opencode.json`), packaged for iOS, Linux, and Termux. Only
legitimate agent features were adopted. Boundaries throughout: no jailbreak
prompts, no refusal-removal content, no hardcoded uncensored model, no
baked-in keys.

## 1. Hermes Agent (Nous Research, MIT)

Terminal-native autonomous agent (`hermes` CLI, `~/.hermes/config.yaml`).
Sources: hermes-agent.nousresearch.com/docs, Maestro docs (maestro.this.live),
Agent Package Manager Hermes integration.

What it does best:

1. **Agent Skills (SKILL.md standard)** — reusable procedures as skills in
   `~/.hermes/skills/<name>/SKILL.md` (global) or `.agents/skills/` (project,
   via `skills.external_dirs`). Compatible with the agentskills.io format, so
   the same skill works in Claude Code, Codex, OpenCode, and others.
   `hermes skills list/search/install/inspect` manages a skills hub/registry.
2. **Self-improving loop** — Hermes writes its own skills as it learns and
   keeps persistent memory with user modeling, so procedures accumulate
   instead of being re-derived every session.
3. **Task routing by job (Maestro)** — `maestro-router route` classifies a
   subtask into one of eleven jobs (plan, code, debug, review, ops, research,
   data, write, edit, summarize, ask) plus a difficulty 0–3, and picks a
   model from a ladder. `maestro-router serve` exposes it as a local
   OpenAI-compatible endpoint (`http://127.0.0.1:4545/v1`, model `maestro/auto`).
4. **One config file for everything** — `model:` (provider/base_url/api_key,
   `custom` provider type), `auxiliary:` (compression, title generation),
   `mcp_servers:` — all in `~/.hermes/config.yaml`, with `hermes config set`
   and an interactive `hermes model` picker.
5. **Sessions + scheduled automation** — transcripts in `~/.hermes/sessions/`,
   cron-based scheduled runs, and messaging-platform reach-out (Telegram,
   Discord, Slack, WhatsApp, Signal).

## 2. OrcaRouter (api.orcarouter.ai)

A model gateway, not an agent — one OpenAI-compatible endpoint fronting many
models. Verified live 2026-11-21 via its public `/v1/models` (214 models).

What it does best:

1. **One endpoint, many models** — switch models by changing the model ID in
   the request; no per-provider client code. Both chat-completions and the
   Responses API are served (`/v1/responses` verified live).
2. **Free tier worth routing to** — 5 free models: `deepseek/deepseek-v4-flash-free`,
   `deepseek/deepseek-v4.1-flash-free`, `tencent/hy3-free`,
   `tencent/hy4-preview-free`, `z-ai/glm-5.3-flash-free`. `z-ai/glm-5.3-flash-free`
   is verified live on this user's key (chat + Responses API).
3. **Model switching as the routing primitive** — the gateway does no
   task classification; the client picks the model per call. That maps
   directly onto a harness-side model picker and per-agent models.
4. **Transparent pricing per model** — each model carries its own price, so
   the free tier is a real routing target, not a trial.

## 3. DeepSeek harness — @deepseek-ai/dsh (what dsh-ios packages)

The official DeepSeek coding-agent harness: Node 22 app with its own web UI,
served on loopback. This is the shell OpenMind Harness was copied from.

What it does best:

1. **Real harness web UI** — sessions, workspaces, tools, permission presets,
   and settings (including API-key management) in the browser, served on
   loopback. The WKWebView front end is the whole product surface.
2. **Supervised server** — free-port selection, HTTP readiness probe, crash
   restart with back-off, health check on foreground, live log tail on the
   startup overlay.
3. **Safe updates** — a new guest image imports as a fresh root while
   `~/.dsh` (sessions, credentials, settings) and the workspace migrate
   automatically.
4. **Profiles** — `web` vs `headless` profiles (same agent, different
   surface/permissions). The closest thing dsh has to task-routed agents.
5. **Host bridge** — iOS capabilities (Health, Contacts, Calendar, Files,
   Shortcuts, …) exposed as agent tools through a local bridge server.

## What was adopted

| Feature | From | How it lives in OpenMind Harness | Verified |
|---|---|---|---|
| Agent Skills (`SKILL.md`) | Hermes | `skills/openmind-harness/SKILL.md` shipped in the repo; installed to `~/.config/opencode/skills/` by both setup scripts and into the iOS guest image by `scripts/build-rootfs.sh`. OpenCode searches that path natively; third-party skills install the same way (`npx skills add …`). | Skill frontmatter valid; `opencode serve` starts clean with it installed. |
| Task-routed agents | Hermes/Maestro + dsh profiles | `agents` in `cross-platform/opencode.json`: `fast` (primary, free fallback model, small jobs) and `reviewer` (subagent, read-only, `openai/gpt-5`). Built-in `build` stays the default; top-level model stays `openai/gpt-5`. | `/agent` endpoint lists `fast` and `reviewer` alongside built-ins; `/config` shows the `fast` model. |
| Free-tier model routing | OrcaRouter | OrcaRouter provider pins the listed-free models: `z-ai/glm-5.3-flash-free` (verified live), `tencent/hy3-free`, `tencent/hy4-preview-free` (listed-free today, not live-tested on this key). | Public `/v1/models` fetched 2026-11-21 (214 models, same 5 free); `opencode models` resolves all three. |
| Provider/model switching in the UI | OrcaRouter + dsh | Already native in OpenCode's model picker; the config just declares all six providers. Nothing added. | `opencode models` resolves all six providers; serve + web start and answer. |
| Sessions | Hermes + dsh | Already native in OpenCode (persistent, resumable sessions). Documented, not reimplemented. | — |
| MCP servers in the same config | Hermes | Documented pattern only (`"mcp"` block example in `cross-platform/README.md`). No server enabled by default. | — (pattern, not a running server) |
| Supervised loopback server | dsh | Kept from the dsh shell: `opencode-serve` as the supervised foreground process, port pick + readiness probe + restart in the iOS app, host-side probe in the CI rootfs build. | CI run 44939429964 green; IPA verified (see main README). |
| `AGENTS.md` context file | Hermes | Repo-root `AGENTS.md` documenting layout, harness facts, and boundaries for coding agents working in this repo. | — (documentation) |
| ChatGPT Plus OAuth (subscription login) | OpenCode built-in | The `openai` provider in `opencode.json` deliberately has **no `apiKey` line**: `{env:OPENAI_API_KEY}` with the var unset resolves to an empty string, which would block the OAuth fallback. The built-in provider reads `OPENAI_API_KEY` from the environment on its own (proven: a run with the line removed and a dummy key set failed with `Incorrect API key provided: sk-dummy*test` — the env key was used). Login methods verified in the 1.19.6 prompt: `ChatGPT Pro/Plus (browser)`, `ChatGPT Pro/Plus (headless)` (device code), `Manually enter API Key`. Credentials land in `~/.local/share/opencode/auth.json` (0600). | Login prompt observed; env auto-read proven; no-key run gives a clean `AI_LoadAPIKeyError` (not an empty-key 401). |

## What was NOT adopted, and why

- **Hermes self-writing skills / persistent user modeling** — OpenCode does
  not auto-generate skills; skills are authored and installed. The starter
  skill is the manual equivalent. Nothing to implement without inventing a
  new agent loop, which the harness brief forbids.
- **Hermes cron / scheduled automation** — OpenCode has no built-in scheduler,
  and the iOS app cannot run background cron. Out of scope.
- **Hermes messaging platforms** (Telegram/Discord/…) — a notification
  surface, not a harness feature; out of scope.
- **Maestro's `maestro/auto` router as a provider** — it needs a local
  `maestro-router serve` process and its own model ladder; the same routing
  is achieved with the built-in `fast`/`reviewer` agents and the model
  picker, with no extra daemon. The Maestro skill itself (`npx skills add
  this-live/maestro-router`) remains installable by the user if wanted.
- **dsh host bridge** (iOS Health/Contacts/Calendar as agent tools) — there
  is no OpenCode equivalent; the Capabilities screen keeps its styling but
  its toggles do not connect tools into OpenCode. Flagged in the main
  handover, not silently removed.
- **OrcaRouter DeepSeek free models** (`deepseek/deepseek-v4-flash-free`,
  `deepseek/deepseek-v4.1-flash-free`) — `deepseek-v4-flash-free` returned
  `403 model_access_denied` on this user's key on 2026-11-21, so DeepSeek
  free access on OrcaRouter looks unstable; and `deepseek-v4.1-flash:free`
  is already the Experiential Labs fallback, so nothing is lost by leaving
  them out. One line in the config re-adds either if access is restored.

## Version notes that shaped the adoption

- OpenCode **1.19.6 is V1 config**. The agents docs describe V2, whose
  `permissions` array (`[{action, resource, effect}]`) is rejected by V1:
  `serve` fails with "V2 permissions are not supported by OpenCode V1."
  The reviewer therefore uses the V1 `permission` map
  (`{"edit": "deny", "bash": "deny"}`), verified to start clean. When the
  harness moves to OpenCode 2.x, migrate it to the V2 `permissions` array.
- Termux runs OpenCode **1.17.9** (guysoft/opencode-termux v0.2.1, the latest
  Android release); iOS/Linux run 1.19.6. Same config on all three — the
  agents and skills fields above are supported on both versions.

## Universality check (2026-11-21)

Every piece of the harness, and where it runs. Nothing is iOS-only or
single-provider by design.

| Piece | iOS guest | Linux | Termux | Notes |
|---|---|---|---|---|
| OpenCode engine | 1.19.6 (musl arm64) | 1.19.6 (glibc x64/arm64) | 1.17.9 (Android aarch64) | Same config; Termux is one minor release behind because upstream publishes no Android binary. |
| `opencode.json` (providers, default `openai/gpt-5`, fallback `experientiallabs/deepseek-v4.1-flash:free`, agents, skills) | Same file | Same file | Same file | Single source of truth; no per-platform config differences. |
| Starter skill | Same | Same | Same | `skills/openmind-harness/SKILL.md` → `~/.config/opencode/skills/`. |
| Sessions, model picker, agent loop, file/shell tools | Same | Same | Same | Stock OpenCode on all three. |
| ChatGPT Plus OAuth login | Device-code in the guest Terminal, or copy `auth.json` in | Browser flow | Browser flow (phone browser shares Termux's localhost) | The browser callback (`localhost:1455`) cannot reach the guest's loopback from iPad Safari — that is the one platform-specific login limit; device-code and the `auth.json` copy cover it. |
| `opencode-serve` launcher script | iOS guest only | — | — | A thin wrapper (`opencode serve` on the guest port with the app's env). Linux/Termux run `opencode serve` / `opencode web` directly. Launcher only, not harness logic. |
| Capabilities screen (host bridge) | iOS shell only | — | — | The screen keeps its styling but its toggles do not connect tools into OpenCode (no OpenCode equivalent for the dsh host bridge). Flagged, not removed. |
| Boot/startup, repair, port allocation | iOS shell only | — | — | The iOS app's supervisor around the guest; the harness itself starts the same way everywhere (`opencode serve`/`web` on loopback). |
