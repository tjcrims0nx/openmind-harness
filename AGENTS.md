# AGENTS.md — OpenMind Harness repo

Instructions for coding agents working in this repository.

## What this is

OpenMind Harness: OpenCode 1.19.6 + one universal multi-provider config, packaged
for iOS/iPadOS (native app, iSH-ARM64 guest + WKWebView), Linux (server/container),
and Android (Termux). The harness is the product; the iOS app is one packaging of it.

## Layout

- `opencode.json` — the single source of truth for the harness config
  (default model `openai/gpt-5`, free fallback `experientiallabs/deepseek-v4.1-flash:free`,
  task-routed agents `fast` and `reviewer`). The iOS guest image and both setup scripts
  install this exact file. Edit it in one place only.
- `linux-setup.sh`, `termux-setup.sh` — install the harness on Linux and
  Termux. `README.md` documents all three platforms.
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
- `ios/app/` — the iOS shell (WKWebView front end, harness supervisor, capabilities).
  Internal identifiers still carry the `DSH` prefix (class/file/project names) — do not
  rename them; the Xcode project, scheme, and CI workflow depend on those names.
- `ios/scripts/build-rootfs.sh` — builds `ios/build/root.tar.gz` (Alpine 3.21 + OpenCode musl arm64).
- `docs/features.md` — the harness's own feature descriptions (providers,
  hooks, memory, autonomy levels, security boundaries).
- `ios/ish-arm64/` — vendored iSH-ARM64 emulator fork. Do not modify unless the emulator itself
  needs a fix.

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
- The iOS build is UNSIGNED (`CODE_SIGNING_ALLOWED=NO`). Never add signing material.
- Branding is "OpenMind Harness" throughout user-visible text. Do not reintroduce
  dsh/DSH/DeepSeek naming (model/provider identifiers in the config are the only exception —
  they must match the providers' APIs exactly).
- The agent itself is stock OpenCode behavior (prompt → model → tools → execute →
  observe → repeat, sessions, model picker). Do not invent custom agent behavior;
  the custom work here is packaging, the provider config, and branding.

## Build and test

- `make -C ios rootfs` — build the guest image (needs macOS + the emulator build).
- `make -C ios project` — regenerate `ios/DSH.xcodeproj` after adding/removing source files.
- `make -C ios test` — emulator, rootfs, and simulator test suites.
- `bash eval/run.sh --dry-run` — validate the eval runner's mechanics without a model.
- CI: `.github/workflows/build-ipa.yml` builds the unsigned IPA on a macOS runner.
