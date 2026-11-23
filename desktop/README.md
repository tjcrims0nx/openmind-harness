# OpenMind Harness Desktop

A **native Electron window** for the existing OMH local-first runtime and cyberpunk chat interface, designed for **Windows, macOS and Linux**. The bundled JavaScript dashboard runs in a separate, short-lived Node process bound only to `127.0.0.1` on a random local port. Electron uses a sandboxed, context-isolated renderer with no Node access and denies external windows, navigations and browser permissions.

## Desktop packages

| OS | Outputs | Notes |
| --- | --- | --- |
| Windows | NSIS installer (`.exe`) and portable `.exe` | Installer may trigger SmartScreen until signed |
| macOS | `.dmg` and `.zip` | Unsigned builds require explicit approval; notarization pending |
| Linux | `.AppImage` and `.deb` | Depends on desktop session/system Electron libraries |

Automated build: [Desktop packages](../.github/workflows/desktop-packages.yml). Artifacts appear under the completed GitHub Actions run, separately for each operating system. The workflow also captures **real running Electron app screenshots** (`omh-chat-desktop.png` and `omh-chat-mobile.png`) using a Linux display server and uploads them as `omh-electron-real-screenshots`. The captured UI remains offline without provider keys; no fabricated chat messages are used. **A green packaging job proves the artifact was created; opening it successfully requires a per-OS launch test.** These packages do not bundle the OpenCode binary, an AI model, Ollama, or a background worker service.

## Run from source

Requires Node.js 24+ and npm plus a supported desktop graphical session:

```sh
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness/desktop
npm install
npm start
```

For packaging, run `npm run dist:win`, `npm run dist:mac` or `npm run dist:linux` on the corresponding operating system. Generated builds are ignored in `dist/desktop/`. No privileged installer action is performed by `npm start`.

## Chat model setup

The desktop app's **Chat** tab communicates with the local dashboard's `/api/chat` endpoint. The server itself contacts approved hosted providers; secrets are read from the desktop process environment and are **never delivered to the renderer**. Set one or more provider environment variables **before launching Electron** (or configure the parent process through your credential manager):

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`
- `GROQ_API_KEY`, `TOGETHER_API_KEY`, `OPENROUTER_API_KEY`
- `ZAI_API_KEY`, `MOONSHOT_API_KEY`, `DASHSCOPE_API_KEY`

The Chat selector shows only configured providers as available; it defaults to the first available provider and does not silently sign you in to a hosted AI service. Server-side model overrides are optional (for example `OMH_CHAT_OPENAI_MODEL`). Model names and provider billing/availability must be verified for your account. This chat endpoint is independent from OpenCode's own provider auth; you do not need a ChatGPT login first.

**Local runtime:** The app starts the bundled read-only dashboard service and reads the OMH state from `OMH_STATE_DIR` or `<app data>/workspace/.omh`. To show your existing tasks and queues, set `OMH_STATE_DIR` before launch. The desktop app does not automatically start agent jobs or the OpenCode daemon.

**Hosted web version:** `openmind-harness.vercel.app` remains separate. Its chat backend uses the same provider adapter but needs provider keys and `OMH_WEB_ACCESS_TOKEN` configured on Vercel; browser authentication is distinct from local desktop authentication. Never commit tokens to Git.

## Security and limits

- Local dashboard binds to `127.0.0.1`; chat POSTs require same-origin and a fresh CSRF token.
- Provider model IDs are fixed or read from validated **server-side** settings; the browser cannot choose arbitrary upstream URLs, submit tool-call roles or gain shell access.
- Messages exist in the browser's memory for the open conversation. They are sent to the selected provider; they are not stored by OMH in a chat database.
- Electron cannot access the Node process from its renderer. The spawned runtime is terminated on application quit.
- App installers are **unsigned** until official platform signing certificates and release verification are configured.

The current desktop package is a standalone shell with local provider chat and runtime visibility—not the complete OpenCode executable or all future Lab features. The iPad/iPhone client remains in `omh-iOS`.
