# OMH runtime modules (experimental)

The independent OMH runtime is a **real local CLI** on top of the existing OpenCode configuration. It does **not** replace OpenCode's native agent loop or patch the upstream OpenCode frontend. The OMH-specific dashboard is a separate, locally hosted runtime interface that reads the same task, memory, policy and trace stores; a restricted MCP bridge connects selected functions to OpenCode.

## Native iPadOS client (separate repository)

The [omh-iOS](https://github.com/tjcrims0nx/omh-iOS) development branch `rebrand/omh` hosts an experimental **native UIKit iPad workspace**, tracked in [PR #4](https://github.com/tjcrims0nx/omh-iOS/pull/4). It reads this runtime dashboard's loopback `GET /api/state` JSON and displays native sidebar/detail lists. The browser dashboard remains accessible as a secondary diagnostic screen, and the OpenCode editor remains a separate embedded web view. iPhone uses a different WebKit-first home. The native iPad UI does not replace the OMH daemon, sandbox, MCP or OpenCode runtime.

The client presents current state only; task cancellation, writes, plugin controls and approvals must still follow the runtime's existing authorization boundaries. A visible row is not evidence that a task runner or sandbox is operational. The iPad sidebar and header now have adaptive width for rotation and Stage Manager windows, but narrow-window visuals and runtime connectivity require simulator/physical-device testing.

The iOS guest uses a **pinned harness revision** at IPA build time; a new commit here is not automatically deployed into an existing IPA. See the [iPad workspace guide](https://github.com/tjcrims0nx/omh-iOS/blob/rebrand/omh/docs/IPAD_WORKSPACE.md) and [build/release verification](https://github.com/tjcrims0nx/omh-iOS/blob/rebrand/omh/docs/BUILD_AND_VERIFY.md). GitHub Actions builds an **unsigned** IPA. Simulator smoke results and physical-device signing/launch must be checked separately. Linux Bubblewrap isolation must not be inferred from the binary's presence in the emulated guest.

## Start

Requires Node.js 22 or newer. From the harness repository root:

```sh
node scripts/omh-runtime.mjs status
node scripts/omh-runtime.mjs doctor
node --test modules/*.test.mjs
```

Set `OMH_WORKSPACE` to a dedicated absolute workspace if you don't want to use your current directory. Runtime state is stored under `$OMH_WORKSPACE/.omh` unless `OMH_STATE_DIR` is provided.

### Runtime dashboard

Run `node scripts/omh-dashboard.mjs` and open `http://127.0.0.1:4177` on the same machine. The installer also copies this entry point and its assets into the installed runtime. Set `OMH_DASHBOARD_PORT` to change the port.

The dashboard exposes five ordinary, downward-only controls: cancel a queued task, retry a failed `workspace.read` task up to the configured limit, pause an enabled schedule, disable a plugin manifest, and reject a pending skill proposal. Three additional **opt-in administrator actions** are available only when the server starts with a strong `OMH_DASHBOARD_ADMIN_TOKEN`: resume a paused schedule, enable a declarative plugin manifest, or accept/publish a reviewed text skill proposal. Configure a **random token of at least 32 bytes** in the local process environment, then enter that token when the interface prompts during an admin action. The token is never served by `/api/session`, recorded in browser storage, or echoed in HTTP responses.

Example (local terminal, keep secrets outside shell history):

```sh
export OMH_DASHBOARD_ADMIN_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
node scripts/omh-dashboard.mjs
```

Native OpenCode agent processes are explicitly stripped of `OMH_DASHBOARD_ADMIN_TOKEN` before startup, even if the parent process happens to have that environment variable. Do not send the token to providers, tools, stored memory, or logs.

The optional administrator channel must only be used from the trusted local browser. **Do not publish the dashboard on a public interface or through an unauthenticated tunnel.** Browser-origin checks, CSRF protection, and tokens are not replacements for OS user isolation or a hardened remotely hosted authentication service. Each action requires a confirmation and calls a local same-origin JSON API guarded by a per-process anti-CSRF token, strict Origin and Host checks, and bounded request bodies. Without the administrator token it cannot enable plugins, publish skills, or resume schedules. Even with the token it cannot execute shell commands, restart native agents, or grant arbitrary filesystem permissions. Pausing a schedule does not cancel tasks already queued. Running tasks must still be managed through a trusted CLI and their existing cancellation policy. This browser-local token is not a defense against malware or other processes running as the same OS user.

The dashboard's health panel now displays the actual server OS, CPU architecture and observed worker heartbeat status. The daemon writes a 2-second heartbeat during long-running jobs; it is considered stale after 15 seconds and removed on clean shutdown. A heartbeat establishes recent liveness, **not** that every provider or agent task is healthy. CLI `status` reports the same worker observation. `/api/state` also reports the Node.js version and whether the Linux Bubblewrap binary is installed; installation alone **does not** prove the sandbox can enforce isolation. Run `omh-runtime.mjs doctor` and inspect the Linux sandbox CI job for real enforcement tests.

The dashboard reads the same state as the CLI and daemon. Workspace search covers the displayed records for agent roles, dependent workflow steps, tasks, memory titles, skill proposals, plugin manifests, traces, sandbox jobs, schedules and workspaces. Task, workflow and sandbox views support status filtering. The console reports queue totals, and the other inspector tabs show workspaces, schedules and logs. Refresh reads a new snapshot. After a failed refresh the dashboard labels the previous snapshot as stale. Use the CLI to submit work, grant approvals or inspect private record contents.

The dashboard uses the original electric-cyan, bolt-accented **M inside a neon hexagon** at [`dashboard/app-icon.webp`](../dashboard/app-icon.webp). The orbital background was generated for OMH. The bundled Orbitron font includes its SIL Open Font License in `dashboard/Orbitron-LICENSE.txt`.

To run the installed-dashboard smoke test, install Python Playwright and Chromium, then run `python scripts/smoke-dashboard.py`. Set `CHROME_BIN` to select a Chromium executable. For WebKit, install its Playwright browser and run the same script with `OMH_SMOKE_BROWSER=webkit`. CI exercises both engines. Set `OMH_SCREENSHOT_DIR` to capture desktop and phone-width screenshots with temporary test records. The test uses an isolated home and workspace.

### Persistent queue and workflow execution

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"workspace.read","input":{"path":"README.md"}}'
node scripts/omh-runtime.mjs task:run
node scripts/omh-runtime.mjs task:list
node scripts/omh-runtime.mjs task:cancel '{"id":"<task-id>"}'
node scripts/omh-runtime.mjs task:retry '{"id":"<failed-task-id>","maxAttempts":3}'
node scripts/omh-runtime.mjs workflow:run '{"name":"inspect","steps":[{"kind":"workspace.read","input":{"path":"README.md"}}]}'
node scripts/omh-runtime.mjs workflow:submit '{"name":"inspect-later","steps":[{"kind":"workspace.read","input":{"path":"README.md"}}]}'
```

`workflow:submit` stores all steps together and returns their task IDs. A worker starts each step only after its predecessor completes. A failed predecessor blocks later steps until a retry succeeds. A cancelled predecessor leaves later steps queued and blocked, so cancel those tasks separately when abandoning the workflow. Use `task:list` to inspect each step and its `dependsOn` field.

Built-in task kinds are **workspace.read**, **workspace.write**, **sandbox.exec**, and **agent.run**. The last runs a registered OMH OpenCode agent through the native `opencode run --format json --agent ... --dir ...` CLI; unlike the sandbox handler, native agent execution uses host OpenCode permissions and networking, so it is **not bubblewrap-isolated**. Writes and execution require an explicit `approved:true` field; this is a cooperative application-level gate, **not** a trusted human identity or privilege boundary. Never expose the CLI's input surface to untrusted users or untrusted model-generated requests without an external approval system. Sequential workflows keep downstream steps **queued but blocked** when a prerequisite fails, so explicitly retrying the failed step can resume the existing workflow. If a prerequisite is **cancelled**, its queued descendants are cancelled with a recorded dependency reason; cancelled workflows must be resubmitted. The daemon never executes a dependent step before its prerequisite completes successfully.

Memory records, agent mailboxes, declarative plugins, and skill proposals now reload and serialize writes under a **bounded, fail-closed local file lock**; deleted backing files clear stale in-memory caches so a later write cannot resurrect purged records. concurrent readers are not guaranteed a consistent cross-store snapshot. Stuck locks are not automatically broken: inspect the owning process before manual recovery. These are local-filesystem guarantees only; use a transactional database for distributed execution.

The queue uses short-lived filesystem locks to prevent simultaneous claims across local workers. Stale running tasks become eligible for recovery after 15 minutes. Failed tasks can be retried explicitly up to a configured attempt limit (default 3). Exactly-once side effects across crashes and distributed/network filesystem support are **not** guaranteed.

`task:cancel` cancels queued work immediately. For a running Bubblewrap task, it records `cancelRequestedAt` and the worker confirms `cancelled` once the sandbox process closes. A task that finishes before the request takes effect keeps its result. If the worker disappears before confirming, recovery reports the request as failed. For a running native agent, the worker asks OpenCode to abort the task’s own session and checks its status. An unconfirmed abort fails the task. Running filesystem handlers currently reject cancellation.

### Native agent teams

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"agent.run","input":{"agent":"reviewer","prompt":"Review the current changes","approved":true}}'
node scripts/omh-runtime.mjs task:run
node scripts/omh-runtime.mjs workflow:run '{"name":"review-cycle","steps":[{"kind":"agent.run","input":{"agent":"planner","prompt":"Plan a bounded review","approved":true}},{"kind":"agent.run","input":{"agent":"reviewer","prompt":"Review the plan and code","approved":true}}]}'
```

Agents `planner`, `implementer`, `tester`, and `reviewer` use OpenCode's `agent` configuration with `mode: "all"`, so OpenCode accepts them both through `run --agent` and through delegation. For each task, the native runner starts a password-protected OpenCode server on loopback, attaches the CLI to one session, and reads the saved assistant response before closing the server. A session error or unexpected agent fails the task. The Linux fixture exercises normal completion, cancellation of an active shell tool, and scoped memory from a custom `OMH_STATE_DIR`. It also runs a native implementer-to-reviewer delegation, checks that the reviewer has no shell tool, and verifies the parent receives its result. Run `node scripts/smoke-native-agents.mjs` with OpenCode 1.19.6 on PATH to reproduce it. Abrupt worker death and cancellation of detached external services need separate verification. It needs an installed OpenCode binary and working model credentials. Run native agent tasks from trusted workspaces with appropriate OpenCode permissions.

### Runtime diagnostics

`node scripts/omh-runtime.mjs doctor` checks Node.js 22+, the availability of the `opencode` command, and (on Linux) attempts a **real Bubblewrap mount-namespace smoke test** in a temporary directory. This is stronger than checking whether `bwrap --version` succeeds. It reports whether the isolation check actually ran; a failed probe is **not** reported as a verified sandbox. The probe does not exercise all filesystem, networking, or resource-limit guarantees and does not validate a live model connection.

### Model reliability and host isolation

**Current default:** `google/gemini-3.5-flash-lite`, selected by `opencode.json` for the main agent and the planner, implementer, reviewer and tester roles. On the affected installation the old `gemini-3.8-flash` default produced zero output after separate 120- and 180-second attempts; `gemini-3.5-flash-lite` answered in approximately six seconds with the same key and setup. This is a specific observed failure, not evidence that the model is universally unavailable. Keep 3.8 in the picker only as an **explicit opt-in** until live responsiveness is reverified.

After updating the repository, **reinstall or copy the updated `opencode.json` into your active `~/.config/opencode/opencode.json` and start a new session**. Check both the selected model and the subagent model. Existing sessions, alternate configuration directories, or saved model selections can still select the old model. `small_model` is used for small internal jobs; it **does not automatically fail over** a hanging main model.

On GitHub Actions, `scripts/smoke-gemini.sh live` now probes only the configured default with a bounded generation request, then exercises a full OpenCode-to-MCP round trip. It **fails** rather than quietly picking another Gemini model if the configured default does not respond. The fixture mode still checks deterministic integration behavior without claiming provider availability. No API key is committed to the repository.

**Bubblewrap is dependent on the host kernel**, even if the `bwrap` executable is installed. Some nested VMs and restricted containers block the `/proc` mount or user/mount namespaces, causing startup to fail before an isolated process can run. In those environments, `sandbox.exec` must **fail closed**, not fall back to unsandboxed shell execution or suggest changing security settings to bypass the kernel restriction. Use `node scripts/omh-runtime.mjs doctor` to inspect capability and `node scripts/smoke-sandbox.mjs` for fuller checks on a trusted real Linux host with permitted namespaces. GitHub Actions sandbox successes validate its runner, **not** the blocked VM or a future Oracle/other host. The native OpenCode agent runner is not Bubblewrap-isolated.

### Execution sandbox

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"sandbox.exec","input":{"command":"node","args":["--version"],"approved":true}}'
node scripts/omh-runtime.mjs task:run
```

Sandbox implementation is in `modules/sandbox.mjs`. Linux `bubblewrap` (`bwrap`) is required. It runs commands with separate mount/pid/user/network namespaces, read-only system folders, a read-write dedicated `.omh/sandboxes/<workspaceId>` workspace, a temporary `/tmp`, a strict environment, output cap and execution timeout. **It fails closed** if Linux/bwrap is unavailable; it never falls back to an unsandboxed shell. Supported executable commands are currently `node`, `python3`, `git`, and `sh`. Sandbox execution **does not mount the project root or `.omh` state directory**; it only mounts its dedicated sandbox directory. The sandbox has **no network access**. Because real sandboxing depends on host kernel configuration and installation, test it on each supported Linux environment before production use. CPU quotas, memory quotas, and macOS/iOS sandbox backends **are not yet implemented**. Workspaces and snapshots alone are not a security boundary.

The Ubuntu 22.04 GitHub Actions sandbox job runs `node scripts/smoke-sandbox.mjs` with Bubblewrap. It verifies workspace writes, denial of host paths and inherited environment variables, process and network namespace isolation, exit status, timeout, and output limits.

### Memory, skills, snapshots, agent teams

```sh
node scripts/omh-runtime.mjs memory:add '{"title":"Conventions","content":"Use ES modules","scope":"project","approved":true}'
node scripts/omh-runtime.mjs memory:search '{"query":"ES modules","scope":"project"}'
node scripts/omh-runtime.mjs memory:list
node scripts/omh-runtime.mjs skill:publish '{"name":"project-review","description":"Project review practice","instructions":"Review tests and log findings.","approved":true}'
node scripts/omh-runtime.mjs workspace:create '{"id":"implementer"}'
node scripts/omh-runtime.mjs workspace:snapshot '{"id":"implementer","snapshotId":"baseline"}'
node scripts/omh-runtime.mjs workspace:restore '{"id":"implementer","snapshotId":"baseline","approved":true}'
node scripts/omh-runtime.mjs agent:send '{"from":"planner","to":"implementer","content":"Review the task breakdown"}'
node scripts/omh-runtime.mjs agent:inbox '{"agent":"implementer"}'
```

Memory is explicit opt-in and scoped. Skills are **manually provided text** (not automatically self-modified). The store and mailboxes are on disk. Agents registered in `opencode.json` provide native OpenCode plan/implement/test/review roles, but no autonomous multi-agent controller is wired to the OpenCode server yet.


### Reviewed skill improvements and plugin studio

Proposals are saved for review and are **not installed automatically**. Publication is a separate explicit action:

```sh
node scripts/omh-runtime.mjs skill:propose '{"name":"review-style","description":"Project review checklist","instructions":"Check regression tests before publishing.","evidence":"A reviewed maintenance finding"}'
node scripts/omh-runtime.mjs skill:proposals
node scripts/omh-runtime.mjs skill:review '{"id":"<proposal-id>","decision":"accept","approved":true}'
```

The plugin registry stores validated declarative manifests and explicit enabled/disabled states:

```sh
node scripts/omh-runtime.mjs plugin:register '{"name":"local.review","version":"1.0.0","capabilities":["files.read"],"approved":true}'
node scripts/omh-runtime.mjs plugin:enable '{"name":"local.review","approved":true}'
node scripts/omh-runtime.mjs plugin:capabilities
```

Plugin registration **does not execute code, install packages, or inject tools into OpenCode/MCP**. The registry is a safe foundation for a future signed plugin loader.

### Scheduling, permission policy and trace

```sh
node scripts/omh-runtime.mjs schedule:add '{"kind":"workspace.read","input":{"path":"README.md"},"everyMs":60000}'
node scripts/omh-runtime.mjs schedule:tick
node scripts/omh-runtime.mjs schedule:list
node scripts/omh-runtime.mjs tool:check '{"name":"sandbox.exec"}'
OMH_TRACE=1 node scripts/omh-runtime.mjs task:run
node scripts/omh-runtime.mjs trace:list
```

Scheduling is tick-based for interactive use. To process tasks and schedules continuously, launch `node scripts/omh-daemon.mjs` as a **single worker** under systemd/launchd/supervisor. The daemon holds a lock file under `.omh/daemon.lock`; if a process crashes, verify that no worker remains before removing the lock. An OS service is **not** installed automatically. For manual runs, use `schedule:tick`. Trace journaling is opt-in, and secrets in known fields/token patterns are redacted; keep its data directory private. Tool permissions are implemented as a policy object; integration with actual MCP tool invocation is still outstanding.

If the scheduler stops after writing a task but before saving the next due time, the next tick reuses the task for that occurrence.


Agent workspace snapshots exclude symbolic links, `.env` variants, key files and known private directories. Snapshots are a convenience/recovery mechanism, **not** an operating-system security isolation boundary.

### OpenCode native MCP integration

The installer copies the OMH Node modules and CLI under `~/.config/opencode/omh-runtime/` and adds a **local stdio MCP server** to the existing OpenCode `opencode.json` without replacing other MCP entries:

```sh
node scripts/install-omh-runtime.mjs --dry-run
node scripts/install-omh-runtime.mjs
node scripts/install-omh-runtime.mjs --check
opencode mcp list
```

The repository's shared `opencode.json` deliberately contains provider/agent settings without a machine-specific MCP executable path. The installer populates the **effective installed** `opencode.json` with an absolute Node executable and copied OMH bridge path; copying the shared JSON alone is **not** a runtime installation. The installer honors `XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`, preserves existing MCP registrations, and `--check` fails if the registration or installed entrypoint is missing/stale. Re-run installation after upgrading Node or relocating the config directory. The iOS guest has a separate packaged MCP configuration and is validated by its own rootfs build.

The Linux and Termux setup scripts run the installer automatically when invoked from a repository checkout and Node.js 22+ is available. The MCP bridge exposes **read-mostly** `omh_status`, `omh_memory_search`, `omh_task_list`, `omh_queue_read`, `omh_trace_recent`, `omh_skill_propose`, `omh_skill_proposals`, `omh_agent_send`, and `omh_agent_inbox`. It deliberately exposes **no direct shell execution, agent invocation, workspace writing, or approval override** to model-generated tool calls. A trusted CLI/daemon remains responsible for executing pending work. This is an explicit runtime boundary, not a guarantee that stock OpenCode tool permissions are enforced by the bridge.

The installed bridge connected over stdio to the pinned OpenCode 1.19.6 binary on Linux. Run `opencode mcp list` or check the UI's MCP status after installation. The automated transport tests cover tool discovery and rejection of privileged calls.

The Gemini connectivity workflow runs two smoke tests. The fixture streams a deterministic tool call to the real OpenCode binary on loopback. The live job uses the repository's `GEMINI_API_KEY` secret and probes **only the pinned default Google model**, failing rather than silently substituting another model. Both jobs verify the reviewer runs, OpenCode calls the installed MCP read tool, and the worker returns the expected file.

## Verified and unverified platforms

GitHub Actions exercises Linux module tests, the real Linux Bubblewrap sandbox, and Chromium/WebKit dashboard smoke tests. Separate macOS and Windows CI smoke jobs check portable runtime status, provider routing, MCP interfaces and diagnostic output; **neither platform has an OS-level execution sandbox backend** in OMH. Any request for `sandbox.exec` on an unsupported host must fail closed rather than execute without isolation. iOS has not been changed, and iOS launch or sandbox behavior must not be inferred from desktop results.

## Local production deployment checklist

1. Install Node.js 22+, the pinned OpenCode binary, and the runtime. Validate with `node scripts/omh-runtime.mjs doctor` and confirm OpenCode MCP discovery. Configure provider API keys outside of source control and never put credentials in task inputs.
2. Run the dashboard on **127.0.0.1 only**. Keep `.omh` owner-restricted, use a private state directory and do not mount it into sandboxes. For high-risk governance changes, set a separate random `OMH_DASHBOARD_ADMIN_TOKEN` of at least 32 bytes. Browser controls never grant arbitrary shell/agent execution.
3. On Linux, install Bubblewrap and run `node scripts/smoke-sandbox.mjs`. A successful `bwrap --version` check is insufficient. Unsupported systems fail closed; macOS/Windows currently support only the portable runtime.
4. Supervise `node scripts/omh-daemon.mjs` with a local process manager. Check `worker.online` in dashboard state; if a lock remains after a crash, verify the process has exited before removing it. Never run multiple daemons against the same writable workspace.
5. Use a dedicated backup procedure for `.omh` during downtime. Restore a consistent copy of the state files rather than copying while the daemon performs writes. The current JSON stores use local file locks, not a distributed database or multi-store atomic transaction.
6. Monitor GitHub Actions jobs for module tests, Linux sandbox, Chromium, WebKit, macOS and Windows. Test actual provider credentials independently through the guarded Gemini workflow. Do not equate a fixture run with every remote provider being reachable.
7. Keep access to the model-facing MCP bridge separate from the trusted CLI, and require operator review before any privileged automation. Retain state backups and redact logs before sharing.

## Remaining hardening

- A fully authenticated remote multi-user dashboard and hosted deployment are **not** implemented. Current dashboard authorization is opt-in and appropriate only for a trusted local user.
- Native agent execution is still governed by OpenCode's permissions and the trusted CLI, rather than by a separately authenticated OS service. MCP continues to expose only restricted tools; it cannot approve execution.
- The local task/agent stores use bounded exclusive locks for individual changes, but **cross-store atomic transactions, distributed workers, and distributed locks** are not supported.
- Linux Bubblewrap isolation is tested in CI. **CPU/memory cgroup quotas and macOS/Windows/iOS OS-level sandbox backends remain unavailable**; no unisolated fallback is permitted.
- Remote provider endpoints require actual credentials. Gemini's fixture/live checks have been exercised, but not every configured provider or infrastructure environment has been verified end-to-end.
- A managed OS service installer, authenticated deployment, disaster recovery drills and completed iOS simulator compatibility are still required before a broad production launch.
