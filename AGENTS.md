# AGENTS.md — OpenMind Harness repo

Instructions for coding agents working in this repository.

## What this is

OpenMind Harness: OpenCode 1.19.6 + one universal multi-provider config, packaged
for Linux (server/container) and Android (Termux). The harness is the product.
The iOS/iPadOS app is a separate repo: [tjcrims0nx/omh-iOS](https://github.com/tjcrims0nx/omh-iOS) — it fetches this repo's config at build time.

## Layout

- `opencode.json` — the single source of truth for the harness config
  (default model `google/gemini-3.5-flash-lite`, configured small model `experientiallabs/deepseek-v4.1-flash:free`,
  task-routed agents `fast` and `reviewer`). Both setup scripts install this
  file, and the omh-iOS build fetches a **pinned commit** from this repo. Update the
  iOS pin and rebuild the guest image to propagate a new config. Edit the source in one place.
- `linux-setup.sh`, `macos-setup.sh`, `windows-setup.ps1`, `termux-setup.sh` —
  install the harness on Linux, macOS, Windows and Termux. `INSTALL.md`
  lists the one-line install command per platform. `README.md` documents
  the platforms.
- `skills/openmind-harness/SKILL.md` — the starter skill (Agent Skills standard).
  Installed to `~/.config/opencode/skills/` by the setup scripts and into the iOS guest image.
- `plugins/openmind-guard/` — the guard plugin (pre-tool denies, post-tool
  audit log). Installed to `~/.config/opencode/plugins/` by the setup
  scripts and into the iOS guest image. Activates on OpenCode 2.x; dormant
  on 1.19.6 (see `docs/features.md`).
- `eval/` — the eval task set and runner (`eval/run.sh`).
- `scripts/set-autonomy.sh` — sets the autonomy level in `opencode.json`
  (`manual` / `auto-read` / `auto-edit` / `full`).
- `scripts/delete-env.sh` — deletes saved env from the device (stored
  credentials, sessions, caches, logs). Installed as `openmind-delete-env`
  on the PATH by the setup scripts and into the iOS guest image. Never
  touches `opencode.json`, skills, plugins, the workspace, or the guest.
- `commands/delete-env.md` — the `/delete-env` command (web UI slash menu)
  that runs the delete-env script.
- `docs/features.md` — the harness's own feature descriptions (providers,
  hooks, memory, autonomy levels, security boundaries).

## Rules

- Never put an API key, token, or secret in the repo, in a config file, or in a commit.
  Keys come from environment variables, the web UI's `/connect` flow, or
  `opencode auth login` (ChatGPT Plus/Pro OAuth for the OpenAI provider) only.
  The OpenAI provider in `opencode.json` deliberately has no `apiKey` line:
  an unset `{env:OPENAI_API_KEY}` resolves to an empty string, which would
  block the OAuth fallback — the built-in provider reads `OPENAI_API_KEY`
  from the environment on its own when it is set.
- No jailbreak prompts, no refusal-removal content, no hardcoded uncensored model.
  Default stays a stock model.
- Branding is "OpenMind Harness" throughout user-visible text. Do not reintroduce
  dsh/DSH/DeepSeek naming (model/provider identifiers in the config are the only exception —
  they must match the providers' APIs exactly).
- The agent itself is stock OpenCode behavior (prompt → model → tools → execute →
  observe → repeat, sessions, model picker). Do not invent custom agent behavior;
  the custom work here is packaging, the provider config, and branding.

## Build and test

- `bash eval/run.sh --dry-run` — validate the eval runner's mechanics without a model.
- The iOS app (unsigned IPA build) lives in [tjcrims0nx/omh-iOS](https://github.com/tjcrims0nx/omh-iOS).
