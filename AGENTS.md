# AGENTS.md — OpenMind Harness repo

Instructions for coding agents working in this repository.

## What this is

OpenMind Harness: OpenCode 1.19.6 + one universal multi-provider config, packaged
for iOS/iPadOS (native app, iSH-ARM64 guest + WKWebView), Linux (server/container),
and Android (Termux). The harness is the product; the iOS app is one packaging of it.

## Layout

- `cross-platform/opencode.json` — the single source of truth for the harness config
  (default model `openai/gpt-5`, free fallback `experientiallabs/deepseek-v4.1-flash:free`,
  task-routed agents `fast` and `reviewer`). The iOS guest image and both setup scripts
  install this exact file. Edit it in one place only.
- `cross-platform/linux-setup.sh`, `cross-platform/termux-setup.sh` — install the harness
  on Linux and Termux. `cross-platform/README.md` documents all three platforms.
- `skills/openmind-harness/SKILL.md` — the starter skill (Agent Skills standard).
  Installed to `~/.config/opencode/skills/` by the setup scripts and into the iOS guest image.
- `app/` — the iOS shell (WKWebView front end, harness supervisor, capabilities).
  Internal identifiers still carry the `DSH` prefix (class/file/project names) — do not
  rename them; the Xcode project, scheme, and CI workflow depend on those names.
- `scripts/build-rootfs.sh` — builds `build/root.tar.gz` (Alpine 3.21 + OpenCode musl arm64).
- `docs/harness-analysis.md` — how this harness compares to Hermes, OrcaRouter, and dsh,
  and which of their features were adopted.
- `ish-arm64/` — vendored iSH-ARM64 emulator fork. Do not modify unless the emulator itself
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

- `make rootfs` — build the guest image (needs macOS + the emulator build).
- `make project` — regenerate `DSH.xcodeproj` after adding/removing source files.
- `make test` — emulator, rootfs, and simulator test suites.
- CI: `.github/workflows/build-ipa.yml` builds the unsigned IPA on a macOS runner.
