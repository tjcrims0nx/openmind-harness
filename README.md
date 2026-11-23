<p align="center">
  <img src="docs/images/omh-hero-mcp.webp" width="100%" alt="OpenMind Harness — MCP servers, providers, agents, workflows, memory, sandbox and dashboard">
</p>

<h1 align="center">OpenMind Harness</h1>

<p align="center"><strong>Local-first AI agent orchestration · Universal model providers · MCP integrations</strong></p>

<p align="center">
  <a href="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/omh-modules.yml"><img src="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/omh-modules.yml/badge.svg" alt="Harness tests"></a>
  <a href="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/portable-packages.yml"><img src="https://github.com/tjcrims0nx/openmind-harness/actions/workflows/portable-packages.yml/badge.svg" alt="Portable packaging"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-9c70fa" alt="GPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-00c7dd" alt="Node.js 22 or newer for the OMH runtime">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> •
  <a href="#mcp-integrations">MCP</a> •
  <a href="#providers-and-authentication">Providers</a> •
  <a href="#local-runtime-and-dashboard">Runtime</a> •
  <a href="#platforms">Platforms</a> •
  <a href="#diagnostics-and-verification">Diagnostics</a> •
  <a href="#documentation">Docs</a>
</p>

---

OpenMind Harness (**OMH**) combines an [OpenCode](https://opencode.ai) coding-agent setup with a separately implemented **local orchestration runtime**. Use your chosen model providers, register MCP tools, manage repeatable tasks and workflows, record redacted traces, and inspect activity in a local dashboard.

**What is implemented today:** OpenCode handles interactive conversations, model selection and its own agent/tool loop. OMH supplies independent Node.js modules, a CLI/daemon, an opt-in MCP bridge, and a dashboard. Some OMH orchestration features remain **experimental** and are **not yet integrated into OpenCode's standard UI or model execution loop**. Do not confuse configured functionality with a running provider, active worker, or verified sandbox.

## Current development status

| | iPad app | Lab MCP | Harness runtime |
| --- | --- | --- | --- |
| **State** | **Needs verification** | **PR #6 in progress** | **Local runtime available** |
| **Evidence** | Startup failure, failed CI, provider-settings captures | Evidence tests passed; real-schema execution test pending | Module CI and portable packages |
| **Details** | [iOS Actions](https://github.com/tjcrims0nx/omh-iOS/actions) | [Lab integration PR](https://github.com/tjcrims0nx/openmind-harness/pull/6) | [Harness Actions](https://github.com/tjcrims0nx/openmind-harness/actions) |

**Latest visual diagnostics:** [iPad startup](#development-screenshots-and-diagnostics) · [Providers UI](#development-screenshots-and-diagnostics) · [iOS build failure](#development-screenshots-and-diagnostics)

## At a glance

| Capability | What it does | State |
| --- | --- | --- |
| **MCP integrations** | Registers a scoped OMH MCP server; optional external MCP integrations | Available; restricted tool set |
| **OpenMind Jailbreak Lab integration** | Native Lab execution, bounded campaigns, evidence, scoring and review workflows | In development in [PR #6](https://github.com/tjcrims0nx/openmind-harness/pull/6); full integration not yet released |
| **Multi-provider models** | Shared OpenCode configuration for hosted and local models | Configured; provider credentials required |
| **Agent roles** | Planner, implementer, tester, reviewer and fast-agent definitions | Configured; native OMH execution separate |
| **Tasks and workflows** | Durable queue, dependencies, retries, scheduling and cancellation semantics | Experimental local runtime |
| **Memory and trace** | Scoped memory, snapshots and opt-in redacted event history | Experimental local runtime |
| **Execution isolation** | Workspace/path controls and Linux Bubblewrap checks | Platform-dependent; fails closed if unavailable |
| **Dashboard** | Read local runtime state and perform scoped, authorized controls | Local server on loopback |
| **Remote operations** | Vercel frontend / protected proxy to an explicitly configured host | Experimental; requires separate setup |

## Architecture

```text
        Model providers                MCP servers and integrations
      (OAuth / API keys)                  (local or remote)
              |                                 |
              v                                 v
       +----------------- OpenCode -----------------+
       | Interactive coding-agent sessions and tools |
       +----------------------+---------------------+
                              |
                         OMH MCP bridge
                     (restricted / read-mostly)
                              |
         +--------------------v----------------------+
         |            OpenMind Harness                |
         |  tasks · agent mailboxes · workflows       |
         |  memory · traces · policy · schedules      |
         +--------------------+----------------------+
                              |
                 CLI / daemon / local state
                              |
                 Local dashboard :4177
```

The diagram describes component relationships, **not** a promise that every feature is automatically connected or enabled.

## Quick start

Install from a trusted clone, or use the platform instructions in [INSTALL.md](INSTALL.md).

<details open>
<summary><strong>Linux</strong></summary>

```bash
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness
bash linux-setup.sh --no-launch
opencode auth login
opencode web
```

</details>

<details>
<summary><strong>macOS</strong></summary>

```bash
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness
bash macos-setup.sh --no-launch
opencode auth login
opencode web
```

</details>

<details>
<summary><strong>Windows (PowerShell)</strong></summary>

```powershell
git clone https://github.com/tjcrims0nx/openmind-harness.git
cd openmind-harness
.\windows-setup.ps1 -NoLaunch
opencode auth login
opencode web
```

</details>

<details>
<summary><strong>Android / Termux</strong></summary>

```bash
pkg update && pkg install -y git curl
git clone https://github.com/tjcrims0nx/openmind-harness.git
bash openmind-harness/termux-setup.sh --no-launch
opencode auth login
opencode web
```

</details>

OpenCode's local web interface normally listens at **http://127.0.0.1:4097**. The interactive OpenCode service and the **OMH dashboard** are different servers.

### Run the independent OMH runtime

Requires **Node.js 22+** and a trusted workspace:

```bash
node scripts/omh-runtime.mjs doctor
node scripts/omh-runtime.mjs status
node scripts/omh-dashboard.mjs
```

Open the local runtime dashboard at **http://127.0.0.1:4177**. Runtime state is stored in the workspace's `.omh` directory unless `OMH_WORKSPACE` or `OMH_STATE_DIR` is configured.

## MCP integrations

**Model Context Protocol (MCP)** provides a standard way for compatible agents to access approved tools and contextual resources. OMH's built-in MCP integration is intentionally scoped; it is not an unrestricted shell tool.

Register the OMH MCP server in your installed OpenCode config:

```bash
node scripts/install-omh-runtime.mjs
node scripts/install-omh-runtime.mjs --check
```

This installs the runtime modules and registers the `omh-runtime` local MCP command. The exposed tools include:

| Category | Example MCP tools | Behavior |
| --- | --- | --- |
| Health | `omh_status`, `omh_doctor` | Inspect runtime and host prerequisites |
| Memory | `omh_memory_search` | Search approved, scoped notes |
| Tasks | `omh_task_list`, `omh_queue_read` | Inspect tasks or queue a bounded read-only workspace inspection |
| Tracing | `omh_trace_recent` | Return redacted trace summaries |
| Skills | `omh_skill_propose`, `omh_skill_proposals` | Submit and review proposals; no automatic publishing |
| Agent messages | `omh_agent_send`, `omh_agent_inbox` | Exchange informational mailbox messages |

OMH validates MCP input schemas before accessing state. This bridge does **not** expose arbitrary command execution, bypass manual approvals, or grant filesystem permissions automatically. Additional MCP services—including Vercel's OAuth MCP—require their own setup: [MCP and runtime guide](docs/omh-runtime.md) · [Vercel integration](docs/vercel-live.md).

### OpenMind Jailbreak Lab — full integration (in development)

The goal of [OMH PR #6](https://github.com/tjcrims0nx/openmind-harness/pull/6) is to bring the **complete [OpenMind Jailbreak Lab](https://github.com/tjcrims0nx/OpenMind-Jailbreak-Lab) workflow into OMH**, not merely expose stored evidence. The Lab's own Python packages remain the execution engine; OMH provides orchestration, MCP integration and, ultimately, a unified dashboard.

| Lab capability | Integration status |
| --- | --- |
| Evidence queries, run summaries, pending-review counts and regression differences | Five-tool read-only MCP foundation in PR #6 |
| Launch a reviewed Guardrail Lab case via the native Lab CLI | Initial opt-in execution MCP added to PR #6 |
| Run a bounded reviewed-benign multi-provider evaluation | Initial opt-in execution MCP added to PR #6 |
| Corpus browser, Guardrail Lab and versioned benchmark selection | Planned |
| Mutation engine, trace replay, guard evaluation and provenance | Planned |
| Human adjudication, scoring, exports and campaign history screens | Planned |
| Unified OMH dashboard and native iPad workflow | Planned; not yet implemented |

The execution bridge is separate from the evidence bridge. **Provider calls are disabled by default** and require explicit operator opt-in and finite campaign budgets. The native Lab enforces eligibility checks; OMH does not replace those checks or treat heuristic findings as confirmed failures.

**Reported test-fixture evidence (November 23, 2026):** The read-only evidence bridge passed 3/3 regression tests with 3 runs and 7 observations. These results do not establish that the new execution bridge, full Lab integration, portable packages, or iPad app work end to end. See the [PR](https://github.com/tjcrims0nx/openmind-harness/pull/6) and its [integration guide](plugins/omjb-mcp/README.md) after merge for operational setup.

## Providers and authentication

Provider definitions live in **[opencode.json](opencode.json)**. The configured default is `google/gemini-3.5-flash-lite`; the separate small-model setting is `experientiallabs/deepseek-v4.1-flash:free`. **A small model is not automatic failover** for a failing primary model.

| Connection | Examples | Authentication |
| --- | --- | --- |
| Major hosted providers | OpenAI, Anthropic, Google Gemini, DeepSeek | OpenCode login or appropriate API credentials |
| OpenAI-compatible gateways | OpenRouter, OrcaRouter, Experiential Labs, APInex, GitHub Models | Provider-issued API keys / tokens |
| Additional endpoints | Z.AI / GLM, Moonshot / Kimi, Qwen / DashScope | Provider-issued API keys |
| Other hosted providers | Groq, Mistral, xAI, Together | Provider-issued API keys |
| Local models | Ollama, LM Studio | Local service availability |
| Custom endpoint | User-defined OpenAI-compatible API | Explicit URL, model and bearer token |
| Antigravity bridge | Google account-connected models | Separate OAuth bridge configuration |

These are **configuration options**, not a claim that every account, model, endpoint, or credential has been live-tested. Availability and billing are controlled by each provider.

```bash
# Let OpenCode present the available sign-in methods
opencode auth login

# After configuring your provider, run a quick model request
opencode run --model google/gemini-3.5-flash-lite "Say hello in one sentence."
```

Keep credentials out of Git, logs, screenshots and chat messages. The OpenCode login flow may support different authentication methods depending on the installed version. See [features and providers](docs/features.md).

## Local runtime and dashboard

The independent OMH runtime includes a persistent task queue, agent mailboxes, memory, workflow dependencies, optional scheduled tasks, skill proposal review, and tracing. The dashboard displays observed state rather than fabricating running agents.

```bash
node scripts/omh-runtime.mjs status
node scripts/omh-runtime.mjs doctor
node --test modules/*.test.mjs
```

The dashboard's ordinary actions are bounded. Additional governance operations require an explicitly configured local administrator token; they do not enable arbitrary agent execution. A worker must actually be running for queued tasks to execute. [Read the runtime and dashboard guide](docs/omh-runtime.md).

### Security and isolation

- **Loopback first.** Local interfaces should stay on `127.0.0.1`. If exposing OpenCode remotely, configure authentication and network controls before changing the bind address.
- **No implicit sandbox success.** Bubblewrap isolation requires a compatible Linux kernel, namespaces and mounts. Check the actual environment; unsupported isolation fails closed.
- **No hidden credential collection.** Store keys using provider-supported credentials or environment variables, never committed configuration files.
- **Human review remains meaningful.** Skill publishing, sensitive state changes and privileged operations have explicit boundaries.

## Platforms

| Platform | Setup | Notes |
| --- | --- | --- |
| Linux | [linux-setup.sh](linux-setup.sh) | Hosts, VMs, containers |
| macOS | [macos-setup.sh](macos-setup.sh) | Apple Silicon and Intel |
| Windows | [windows-setup.ps1](windows-setup.ps1) | PowerShell, x64 and ARM64 |
| Android / Termux | [termux-setup.sh](termux-setup.sh) | Android shell environment; separate OpenCode build |

**[Full installation guide](INSTALL.md)** contains prerequisites and platform-specific details. GitHub Actions also assembles [portable runtime packages](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/portable-packages.yml) for these targets. They are **Node.js launcher bundles, not standalone native executables**, and the Termux package is not a verified device binary.

## Development screenshots and diagnostics

**Captured 22–23 November 2026** · Native iPad bring-up and iOS CI

The recent screenshots are **not a successful IPA release**. They show an actual startup error, the providers configuration screen, and a failed CI check. The original screenshots have been identified, but the image assets are **not yet uploaded to this GitHub repository**; they cannot be displayed here until that upload is complete.

| Screen | What is visible | Status |
| --- | --- | --- |
| **iPad startup / boot log** | OpenMind Harness splash, boot progress and diagnostic output | Startup error observed; working launch unverified |
| **Providers settings** | Provider list, disconnected states and settings navigation | UI captured; provider sign-in unverified |
| **iOS CI** | Unsigned IPA build failed; dependent checks skipped | Build not release-ready |

**Follow the live build evidence:** [omh-iOS Actions](https://github.com/tjcrims0nx/omh-iOS/actions) · [omh-iOS repository](https://github.com/tjcrims0nx/omh-iOS) · [Harness CI](https://github.com/tjcrims0nx/openmind-harness/actions)

*Visual policy:* Only label real device screenshots as screenshots. Keep concept artwork separate, remove any exposed tokens or personal account information, and publish captures under `docs/images/diagnostics/` with descriptive filenames.

## Testing and project status

- [Full module regression](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/omh-modules.yml)
- [Installer matrix](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/installer-test.yml)
- [Portable package build](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/portable-packages.yml)
- [Experimental live Vercel/MCP](docs/vercel-live.md)
- [Current capability notes](docs/features.md) and [integration roadmap](docs/omh-unified-agent-roadmap.md)

Check the **latest workflow run and exact commit** before treating any binary, integration or provider as release-ready. Passing unit tests does not prove real credentials, remote MCP authorization, host sandboxing or an external provider's availability.

## Documentation

| Guide | Contents |
| --- | --- |
| [INSTALL.md](INSTALL.md) | Platform installs and first-use steps |
| [Features](docs/features.md) | Provider/agent/runtime capabilities |
| [OMH runtime and MCP](docs/omh-runtime.md) | CLI, daemon, dashboard, tool boundaries |
| [Vercel + remote MCP](docs/vercel-live.md) | Protected remote connectivity |
| [Agent integration roadmap](docs/omh-unified-agent-roadmap.md) | Completed and pending integration work |
| [Evaluations](eval/README.md) | Harness benchmark and runner |
| [Licensing](LICENSE.md) | Third-party components and notices |

---

<p align="center">
  <strong>OpenMind Harness · MCP-aware · Multi-provider · Local-first</strong><br>
  <sub>Open-source software under <a href="LICENSE">GPL-3.0</a>. Built around explicit access controls and verifiable runtime state.</sub>
</p>
