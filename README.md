> [!WARNING]
> **BETA — ACTIVE TESTING REQUIRED**
>
> OpenMind Harness is currently in beta and requires further testing and validation. Features, integrations, and platform support may be incomplete, unstable, or change without notice. Expect bugs; verify behavior in a non-production environment before relying on it for important work. Please report reproducible issues through [GitHub Issues](https://github.com/tjcrims0nx/openmind-harness/issues).

<p align="center">
  <img src="docs/images/omh-hero-mcp.webp" alt="OpenMind Harness · local AI runtime, agents, providers and MCP" width="100%">
</p>

<h1 align="center">OpenMind Harness</h1>
<p align="center"><strong>One workspace. Your models. Your agents. Your tools.</strong></p>
<p align="center"><sub>Local-first AI orchestration • Multi-provider • MCP • Workflows • Windows/macOS/Linux desktop</sub></p>

<p align="center">
  <a href="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/omh-modules.yml"><img src="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/omh-modules.yml/badge.svg" alt="Module tests"></a>
  <a href="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/portable-packages.yml"><img src="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/portable-packages.yml/badge.svg" alt="Portable packages"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-8961e8" alt="GPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-bf00ff" alt="Node 22+">
</p>

<p align="center"><sub>
<a href="#-overview">Overview</a> ·
<a href="#-downloads">Downloads</a> ·
<a href="#-quick-start">Install</a> ·
<a href="#-providers">Providers</a> ·
<a href="#-mcp--plugins">MCP</a> ·
<a href="#-jailbreak-lab">Jailbreak Lab</a> ·
<a href="#-desktop-application">Desktop</a> ·
<a href="#-docs--links">Docs</a>
</sub></p>

---

### 📥 Downloads

**Desktop — v0.1.0-beta.1 (unsigned beta)**

| Platform | Package | Download |
| --- | --- | --- |
| 🪟 Windows x64 | `.exe` | [Windows installer](https://github.com/tjcrims0nx/openmind-harness/releases/tag/v0.1.0-beta.1#assets) |
| 🍎 macOS Apple Silicon (arm64) | `.dmg` / `.zip` | [macOS packages](https://github.com/tjcrims0nx/openmind-harness/releases/tag/v0.1.0-beta.1#assets) |
| 🐧 Linux x86_64 / amd64 | `.AppImage` / `.deb` | [Linux packages](https://github.com/tjcrims0nx/openmind-harness/releases/tag/v0.1.0-beta.1#assets) |

[All desktop releases](https://github.com/tjcrims0nx/openmind-harness/releases)

Select the matching package from the release assets. Verify the published SHA-256 checksums before installing. Desktop packages are unsigned.

### ⚡ Overview

**OMH** brings together [OpenCode](https://opencode.ai), configurable model providers, an independent Node.js orchestration runtime, a scoped MCP bridge and a local dashboard.

- 🤖 **Agents** — configured planner, implementer, tester, reviewer and fast roles.
- 🌐 **Models** — hosted, gateway, local and custom provider configurations.
- 🔌 **MCP** — approved tools for tasks, memory, diagnostics, traces and skills.
- 🧠 **Runtime** — local task queue, workflows, schedules, mailboxes and scoped memory.
- 📊 **Dashboard** — local activity and observed state at `127.0.0.1:4177`.
- 🛡️ **Controls** — schema validation, scoped permissions, reviewed changes and platform-dependent sandbox checks.

<sub>OpenCode handles its own model conversations and native tool loop. OMH's separate orchestration modules are experimental; they are not all wired into OpenCode's standard execution loop.</sub>

### 🚀 Quick start

**Desktop beta:** [v0.1.0-beta.1](https://github.com/tjcrims0nx/openmind-harness/releases/tag/v0.1.0-beta.1) — Windows x64 `.exe`, macOS arm64 `.dmg` / `.zip`, Linux amd64 `.deb` / x86_64 `.AppImage`. Packages are unsigned; review the published SHA-256 checksums before installation. See [desktop documentation](desktop/README.md) for limitations.

**Choose your platform** ([full installation guide](INSTALL.md)).

<details open>
<summary>🐧 Linux</summary>

```bash
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness
bash linux-setup.sh --no-launch
opencode auth login
opencode web
```
</details>

<details>
<summary>🍎 macOS</summary>

```bash
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness
bash macos-setup.sh --no-launch
opencode auth login
opencode web
```
</details>

<details>
<summary>🪟 Windows · PowerShell</summary>

```powershell
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness
.\windows-setup.ps1 -NoLaunch
opencode auth login
opencode web
```
</details>

<details>
<summary>🤖 Android · Termux</summary>

```bash
pkg update && pkg install -y git curl
git clone https://github.com/tjcrims0nx/openmind-harness.git
bash openmind-harness/termux-setup.sh --no-launch
opencode auth login
opencode web
```
</details>

**OpenCode UI:** `http://127.0.0.1:4097` · Connect a provider when you are ready. No particular hosted provider is required to be the default for your installation.

**OMH local runtime** (Node.js 22+):

```bash
node scripts/omh-runtime.mjs doctor
node scripts/omh-runtime.mjs status
node scripts/omh-dashboard.mjs
```

**OMH dashboard:** `http://127.0.0.1:4177` · Local state normally lives in `.omh/`. See [runtime docs](docs/omh-runtime.md).

### 🌐 Providers

Use the providers supported by your OpenCode installation and the settings in [`opencode.json`](opencode.json).

| 🔑 Hosted | 🔀 Gateways | 💻 Local |
| --- | --- | --- |
| OpenAI, Anthropic, Gemini, DeepSeek | OpenRouter, OrcaRouter, APInex, Experiential Labs | Ollama, LM Studio |
| GLM / Z.AI, Moonshot / Kimi, Qwen | GitHub Models and custom compatible endpoints | Your local models |
| Groq, Mistral, xAI, Together | User-defined API URL + key | No cloud key needed for local-only use |

The committed config currently names `google/gemini-3.5-flash-lite` as its default and `experientiallabs/deepseek-v4.1-flash:free` as its small model. **Configured does not mean authenticated, available or tested**; the small-model setting is not automatic failover.

```bash
opencode auth login
# Once connected, choose a supported model in OpenCode.
```

<sub>Keep credentials out of Git and logs. Provider availability and billing depend on each service.</sub>

### 🔌 MCP & plugins

Register OMH's local MCP bridge:

```bash
node scripts/install-omh-runtime.mjs
node scripts/install-omh-runtime.mjs --check
```

**Built-in scoped tool groups:**
`omh_status` · `omh_doctor` · `omh_memory_search` · `omh_task_list` · `omh_trace_recent` · `omh_agent_inbox` · skill proposals and bounded queue operations.

OMH MCP does **not** grant an unrestricted shell, automatic approvals or arbitrary filesystem access. Additional MCP connectors are configured separately. [MCP guide](docs/omh-runtime.md).

### 🧪 Jailbreak Lab

OMH includes an optional **read-only evidence MCP** for the separate [OpenMind Jailbreak Lab](https://github.com/tjcrims0nx/OpenMind-Jailbreak-Lab). It exposes five bounded aggregate evidence tools, not raw prompts, execution or provider calls. Enable it explicitly in Plugins with an existing evidence database; it starts with OMH, retries unexpected disconnections at most five times and shuts down with the app. Settings persist; the evidence database is read-only. See [plugin documentation](plugins/omjb-mcp/README.md).

### 🖥️ Desktop application

**OMH Desktop** is an Electron app for **Windows, macOS and Linux** with the official neon hexagon branding, black and neon purple, chat-first OpenUI interface and local OMH runtime dashboard. Built OpenUI is served at `/`; the classic fallback remains at `/classic`. No mandatory OpenAI login or default provider in OpenUI.

- 🖥️ Native window with sandboxed, isolated renderer; local dashboard bound to `127.0.0.1`.
- 💬 Authenticated multi-provider chat through the local dashboard; configure API keys securely in the desktop process environment.
- 📦 Windows `.exe`, macOS `.dmg` / `.zip`, Linux `.AppImage` / `.deb` packaging workflows.
- 🔧 [Desktop setup and limitations](desktop/README.md) · [Desktop build workflow](.github/workflows/desktop-packages.yml).

<p align="center">
  <img src="docs/images/omh-openui-desktop.webp" alt="OpenMind Harness chat interface on desktop" width="720">
  <img src="docs/images/omh-openui-mobile.webp" alt="OpenMind Harness chat interface on mobile" width="220">
</p>
<p align="center"><sub>Chat-first OpenUI interface — desktop and mobile.</sub></p>

**Unsigned beta, not a signed production release.** Release baseline `c7f254e`: reported CI verification includes 137/137 module tests, desktop/mobile OpenUI smoke, ten provider routes, evidence-plugin lifecycle and five matching installer checksums. CI packaging and installer checks do not establish successful GUI launch on every target machine. Windows signing and macOS signing/notarization remain pending.

### 🛡️ Security & verification

- 🔒 Local interfaces bind to loopback by default; use authentication and network controls for any remote exposure.
- 🧱 Linux Bubblewrap availability **does not prove** sandbox execution. Unsupported isolation must fail closed.
- ✅ Run `node --test modules/*.test.mjs` and check the actual CI commit before trusting a release.
- 🧾 Review outputs and privileged actions explicitly; configured agents and providers are not automatically running.

### 📚 Docs & links

| | |
| --- | --- |
| 📦 [Installation](INSTALL.md) | 🛠️ [Features](docs/features.md) |
| ⚙️ [Runtime & MCP](docs/omh-runtime.md) |
| 🗺️ [Roadmap](docs/omh-unified-agent-roadmap.md) | 🧪 [Evaluations](eval/README.md) |
| 🏗️ [Harness CI](https://github.com/tjcrims0nx/openmind-harness/actions) | 📱 [iOS CI](https://github.com/tjcrims0nx/omh-iOS/actions) |
| 📄 [License](LICENSE) | 📋 [Notices](LICENSE.md) |

---

<p align="center"><sub><strong>OPENMIND HARNESS</strong> · Local-first · Multi-provider · MCP-ready<br>GPL-3.0 · Build and runtime capabilities should be verified on the target platform.</sub></p>
