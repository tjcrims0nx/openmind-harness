# OMH runtime modules (experimental)

The independent OMH runtime is a **real local CLI** on top of the existing OpenCode configuration. It does **not** replace OpenCode's native agent loop, and it is **not yet plugged into OpenCode's UI**. It is deliberately a separate entry point while testing native integration.

## Start

Requires Node.js 22 or newer. From the harness repository root:

```sh
node scripts/omh-runtime.mjs status
node --test modules/*.test.mjs
```

Set `OMH_WORKSPACE` to a dedicated absolute workspace if you don't want to use your current directory. Runtime state is stored under `$OMH_WORKSPACE/.omh` unless `OMH_STATE_DIR` is provided.

### Persistent queue and workflow execution

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"workspace.read","input":{"path":"README.md"}}'
node scripts/omh-runtime.mjs task:run
node scripts/omh-runtime.mjs task:list
node scripts/omh-runtime.mjs workflow:run '{"name":"inspect","steps":[{"kind":"workspace.read","input":{"path":"README.md"}}]}'
```

Built-in task kinds are **workspace.read**, **workspace.write**, **sandbox.exec**, and **agent.run**. The last runs a registered OMH OpenCode agent through the native `opencode run --format json --agent ... --dir ...` CLI; unlike the sandbox handler, native agent execution uses host OpenCode permissions and networking, so it is **not bubblewrap-isolated**. Writes and execution require an explicit `approved:true` field; this is a cooperative application-level gate, **not** a trusted human identity or privilege boundary. Never expose the CLI's input surface to untrusted users or untrusted model-generated requests without an external approval system. The queue persists tasks and marks interrupted `running` tasks as `queued` on restart. Use a **single worker**; multi-process locking and exactly-once execution are not implemented.

### Native agent teams

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"agent.run","input":{"agent":"reviewer","prompt":"Review the current changes","approved":true}}'
node scripts/omh-runtime.mjs task:run
node scripts/omh-runtime.mjs workflow:run '{"name":"review-cycle","steps":[{"kind":"agent.run","input":{"agent":"planner","prompt":"Plan a bounded review","approved":true}},{"kind":"agent.run","input":{"agent":"reviewer","prompt":"Review the plan and code","approved":true}}]}'
```

Agents `planner`, `implementer`, `tester`, and `reviewer` are registered in `opencode.json`. The native runner does not pass `--auto` and captures JSON event output. It needs an installed OpenCode binary and working model credentials. The API-level `approved:true` flag is not a substitute for OS permission controls or an authenticated human approval system. On production hosts, invoke this only from trusted workspaces.

### Execution sandbox

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"sandbox.exec","input":{"command":"node","args":["--version"],"approved":true}}'
node scripts/omh-runtime.mjs task:run
```

Sandbox implementation is in `modules/sandbox.mjs`. Linux `bubblewrap` (`bwrap`) is required. It runs commands with separate mount/pid/user/network namespaces, read-only system folders, a read-write dedicated `.omh/sandboxes/<workspaceId>` workspace, a temporary `/tmp`, a strict environment, output cap and execution timeout. **It fails closed** if Linux/bwrap is unavailable; it never falls back to an unsandboxed shell. Supported executable commands are currently `node`, `python3`, `git`, and `sh`. Sandbox execution **does not mount the project root or `.omh` state directory**; it only mounts its dedicated sandbox directory. The sandbox has **no network access**. Because real sandboxing depends on host kernel configuration and installation, test it on each supported Linux environment before production use. CPU quotas, memory quotas, and macOS/iOS sandbox backends **are not yet implemented**. Workspaces and snapshots alone are not a security boundary.

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

## Remaining hardening

- Hook live tracing, policy decisions, and skill management into a supported OpenCode event/plugin API and expose the features in its frontend.
- Add tamper-resistant approval and credential isolation, and enforce policy at the actual OpenCode/MCP tool call boundary. The task queue and schedule store now use short-lived filesystem locks; the mailbox, memory, skill proposal and plugin stores do not yet support concurrent writers.
- Implement macOS/iOS sandbox backends, OS-level CPU/memory quotas, and sandbox integration tests.
- Add dependency-aware distributed workflows, OS service installation/health checks, and robust cancellation/retry policy.
- Validate installed tool paths and agent configuration on each target platform before claiming full parity.
