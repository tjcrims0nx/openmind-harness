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

Built-in task kinds are **workspace.read**, **workspace.write**, and **sandbox.exec** only. Writes and execution require an explicit `approved:true` field; this is a cooperative application-level gate, **not** a trusted human identity or privilege boundary. Never expose the CLI's input surface to untrusted users or untrusted model-generated requests without an external approval system. The queue persists tasks and marks interrupted `running` tasks as `queued` on restart. Use a **single worker**; multi-process locking and exactly-once execution are not implemented.

### Execution sandbox

```sh
node scripts/omh-runtime.mjs task:add '{"kind":"sandbox.exec","input":{"command":"node","args":["--version"],"approved":true}}'
node scripts/omh-runtime.mjs task:run
```

Sandbox implementation is in `modules/sandbox.mjs`. Linux `bubblewrap` (`bwrap`) is required. It runs commands with separate mount/pid/user/network namespaces, read-only system folders, a read-write mounted workspace, a temporary `/tmp`, a strict environment, output cap and execution timeout. **It fails closed** if Linux/bwrap is unavailable; it never falls back to an unsandboxed shell. Supported executable commands are currently `node`, `python3`, `git`, and `sh`. The sandbox has **no network access**. Because real sandboxing depends on host kernel configuration and installation, test it on each supported Linux environment before production use. CPU quotas, memory quotas, and macOS/iOS sandbox backends **are not yet implemented**. Workspaces and snapshots alone are not a security boundary.

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

### Scheduling, permission policy and trace

```sh
node scripts/omh-runtime.mjs schedule:add '{"kind":"workspace.read","input":{"path":"README.md"},"everyMs":60000}'
node scripts/omh-runtime.mjs schedule:tick
node scripts/omh-runtime.mjs schedule:list
node scripts/omh-runtime.mjs tool:check '{"name":"sandbox.exec"}'
OMH_TRACE=1 node scripts/omh-runtime.mjs task:run
node scripts/omh-runtime.mjs trace:list
```

Scheduling is **tick-based**: call `schedule:tick` from systemd/cron/Task Scheduler if you want recurring delivery. There is **no background service installed by default**. Trace journaling is opt-in, and secrets in known fields/token patterns are redacted; keep its data directory private. Tool permissions are implemented as a policy object; integration with actual MCP tool invocation is still outstanding.

## Remaining hardening

- Hook into a supported OpenCode event/plugin API and expose the features in its frontend.
- Add tamper-resistant approval and credential isolation, hardened MCP policy enforcement, and queue locking.
- Implement macOS/iOS sandbox backends, OS-level CPU/memory quotas, and sandbox integration tests.
- Add true dependency-aware distributed workflows, scheduled daemon management, and runtime health checks.
- Validate installed tool paths and agent configuration on each target platform before claiming full parity.
