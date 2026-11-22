# Current repository compatibility audit (2026-11-21)

> **Historical snapshot.** This audit documents repository state on November 21, 2026, not the current default model or current feature implementation. As of November 22, the main and delegated agent defaults are `google/gemini-3.5-flash-lite` following observed 3.8 Flash stalls. See [runtime documentation](omh-runtime.md#model-reliability-and-host-isolation) and the current [`opencode.json`](../opencode.json). The iOS repository was not changed.

Checked directly against main of `tjcrims0nx/openmind-harness` and `tjcrims0nx/omh-ios`. This is a **static source review**, not a successful CI, device, or provider invocation.

## Confirmed alignment

- `opencode.json` selects `google/gemini-3.8-flash`; `reviewer` selects the same, `fast` and `small_model` select `experientiallabs/deepseek-v4.1-flash:free`.
- The config declares 18 provider keys including `orcarouter`, `deepseek`, `google`, `openai`, `openrouter`, `ollama`, `lmstudio`, and `custom`.
- `omh-ios/scripts/build-rootfs.sh` clones the harness, copies `opencode.json`, skills and plugins into the guest image, and installs Antigravity bridge/login scripts. The build-time validator checks Gemini, agents and a subset of providers.
- The separate iOS application's guest launcher starts `/usr/local/bin/opencode-serve`; the guest script launches `opencode web --hostname 127.0.0.1`. The iOS web interface therefore depends on the actual OpenCode guest server.
- `modules/smart-router.mjs` implements pure selection, failover filtering, cost estimation and budget arithmetic; `modules/smart-router.test.mjs` has six node:test cases.

## Gaps and risks

1. **Smart Router is not integrated:** the module is not imported by the OpenCode agent loop, iOS guest scripts or UI. No live provider health/cost source exists. The unit test file's presence does not prove CI executed it.
2. **iOS image does not install Smart Router:** build-rootfs copies configuration, skills, plugins and selected scripts, not `modules/`. Adding routing to the harness repo alone cannot expose it in the iOS guest.
3. **iOS autonomy incompatibility:** `scripts/set-autonomy.sh` invokes `python3`; the iOS build documentation says Python is not installed. No native UI exists for the presets.
4. **Guard plugin activation uncertain:** `docs/features.md` explicitly reports that OpenCode 1.19.6 does not load the shipped guard plugin. Do not claim its hook denials work; confirm protection using live permission tests.
5. **Provider configuration is not provider connectivity:** the existence of Gemini or OrcaRouter model IDs is not proof those model IDs currently answer. Keys must be supplied on the device.
6. **Missing modules:** no implementation evidence found in inspected paths for Trace Inspector, durable task queue, skill-approval workflow, Plugin Studio, or remote workers. These remain roadmap items.
7. **Existing docs need caution:** `docs/features.md` describes the plugin as dormant and the router is experimental; feature summaries should not describe either as fully active.
8. **iOS launch unverified:** a valid server executable path and health probe do not establish that the app stays running, presents the workspace, or survives suspend/resume.

## Implementation order based on current source

1. Repair and test the iOS boot and workspace lifecycle; verify real agent/tool execution.
2. Add node:test to CI and a read-only config/packaging contract check.
3. Decide the supported OpenCode provider hook boundary before integrating Smart Router; do not silently override user-selected models.
4. Make autonomy presets work on iOS without Python and expose current permissions.
5. Verify security hooks at runtime; fix the supported enforcement layer before enabling plugins from untrusted sources.
6. Implement tracing, memory approvals, durable task queue, and remote worker support behind feature flags.

## Release evidence required

For each feature record source commit, automated test, real provider/guest invocation if relevant, iOS simulator/device interaction, and observed failures. Static review alone must not be labeled verified.
