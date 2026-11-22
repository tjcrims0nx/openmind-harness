# OMH Unified Agent Platform — independent feature integration

Research references (feature inspiration only):
- DeepSeek Harness: https://www.deepseek.com/harness/en/ and https://github.com/deepseek-ai/deepseek-harness
- OrcaRouter: https://www.orcarouter.ai/
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- Shadow: https://shadow.redpillreader.com/

No proprietary code, UI assets, trademarks, or undocumented APIs should be copied. Review licenses and retain required notices for any open-source code actually reused. Build original OMH modules around the existing OpenCode runtime. Existing iOS GPL-3.0 obligations remain.

## Priority 0 — reliable full harness on iOS

- Boot the real OpenCode workspace; verify workspace selection, file tools, terminal, sessions, model picker, and settings on simulator/device.
- Fix app launch crashes and reconnect logic before adding complex services.
- Keep OMH dark / electric blue / neon cyan visual identity.
- Ensure provider credentials are entered on device, stored securely, and never shipped in IPA.

## Priority 1 — highest-value additions

1. **OMH Smart Router (OrcaRouter-inspired):** Keep direct provider selection; optionally use OrcaRouter as a gateway through the existing provider config. Add policy-driven routing (manual / quality / balanced / budget), health checks, failover before output begins, per-session token/cost receipts and user-set spending limits. Do not claim vendor routing guarantees as OMH benchmarks.
2. **OMH Trace Inspector (DeepSeek-inspired):** Capture structured events for agent turns, tool requests, approvals, execution duration, errors and outputs, with secret redaction. Inspect timeline in iOS and web. Use bounded retention and export.
3. **OMH Memory Engine (Hermes-inspired):** User-controlled durable project notes and cross-session search. Add an opt-in skill proposal workflow that shows a diff and requires approval before persisting a new or modified skill. Never silently rewrite instructions.
4. **OMH Agent Teams (DeepSeek/Shadow-inspired):** Plan, build, review and delegated subagents with isolated context, bounded concurrency, cancellation and result summaries. Preserve read-only reviewer and tool permissions.
5. **OMH Background Task Manager:** Durable task queue, progress, pause/resume and recovery. iOS app suspension limits local execution: offer explicit remote worker integration for long-running jobs rather than promise unrestricted iOS background execution.

## Priority 2 — power-user workflows

6. **OMH Plugin Studio:** Skills and MCP catalog, manifest/schema validation, scoped permissions, plugin installation preview and rollback. Do not enable untrusted plugins without user approval.
7. **OMH Workflow Scheduler:** Local scheduling while app is active, optional remote scheduler for reliable unattended jobs; audit execution and require authorization for mutating actions.
8. **OMH Workspace & Permission Center:** Workspace picker, git diff review, reversible edits, policy presets, approval queue and tool/MCP firewall.
9. **OMH Remote Workers:** SSH/container/cloud execution with explicit connection profiles, encrypted credentials, capability boundaries and job cleanup.
10. **OMH Multi-Surface Gateway:** Optional notifications and external chat integrations; default off, opt-in authentication and per-channel permissions.

## Implementation contracts

- Define adapters at provider, memory, task, event and tool-policy boundaries; no second competing agent loop.
- Version JSON schemas for event log, router policy, task state, plugin manifest and memory proposal.
- Keep credentials out of logs, traces, session exports and test fixtures.
- Route MCP/subagent tool calls through enforceable permission boundaries; current guard plugin is documented as dormant under OpenCode 1.19.6.
- Every module needs unit tests, integration tests, and iOS UI tests where exposed.
- Test crash/restart, network loss, offline operation, missing provider keys, denied permissions, budget exhaustion and failed remote workers.

## Verification labels

- **Configured:** a setting or script exists.
- **Implemented:** functional code and tests exist.
- **Verified on iOS:** simulator/device tests demonstrate the user interaction and successful end-to-end operation.
- **Not supported:** platform constraint documented with an alternative.

Do not label roadmap items implemented or verified without evidence.
