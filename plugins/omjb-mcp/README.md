# OpenMind Jailbreak Lab — MCP integration (evidence + execution bridge)

The **evidence server** in this optional integration is read-only and connects the independent [OpenMind Jailbreak Lab](https://github.com/tjcrims0nx/OpenMind-Jailbreak-Lab) evidence database with OpenMind Harness / OpenCode. It does **not** copy the lab's prompt corpus or execute test campaigns. It is opt-in and disabled unless you register it yourself.

The adapter is designed for authorized, evidence-based AI security evaluation and displays only aggregate information. It does **not** expose raw test prompts, model responses, sensitive adjudication notes, stored configurations, provider secrets, or filesystem contents.

## Requirements

- Node.js **22+** and Python **3.10+** (Python's standard library SQLite module).
- A local SQLite evidence database produced by OpenMind Jailbreak Lab, using its OMJB schema.
- An OpenCode/OMH installation where you are permitted to edit the MCP config.

## Setup

Clone the repositories separately, or use the bundled `plugins/omjb-mcp` directory from an OMH portable runtime package. Point `OMJB_DB_PATH` to your existing Lab `openmind.db` (not to the prompt corpus). No database is created.

The server is at `plugins/omjb-mcp/server.mjs`. In OpenCode's `opencode.json` add an **explicit opt-in** entry under `mcp` (merging with existing MCP entries):

```json
{
  "mcp": {
    "omjb-evidence": {
      "type": "local",
      "command": ["node", "/ABSOLUTE/PATH/openmind-harness/plugins/omjb-mcp/server.mjs"],
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

Set `OMJB_DB_PATH=/ABSOLUTE/PATH/OpenMind-Jailbreak-Lab/openmind.db` in the trusted environment that launches OpenCode. To choose an explicit Python interpreter, set `OMJB_PYTHON` (default `python3`). Do not supply keys or secrets to this plugin. OpenCode's effective environment must expose the path to the MCP subprocess. Do not serve the database or OpenCode web endpoint on a public network.

The OMH installer **copies** the plugin into the installed runtime, but never registers or enables it without an operator action. Installed path: `~/.config/opencode/omh-runtime/plugins/omjb-mcp/server.mjs` (or under `XDG_CONFIG_HOME`).

## MCP tools

| Tool | Output |
| --- | --- |
| `omjb_status` | Whether a DB is configured, run/observation counts |
| `omjb_list_runs` | Last 1–50 run IDs and observation counts |
| `omjb_run_summary` | Heuristic label counts and separately reviewed human outcomes for one run |
| `omjb_pending_reviews` | Unadjudicated result count for a run |
| `omjb_compare_runs` | Aggregate detector label changes between two runs |

All calls are schema-validated and invoke a **fixed** local Python helper in SQLite query-only mode. No model call, campaign launch, shell command, arbitrary file read, corpus export, injection rewriting, or privileged approval is available. Heuristic flags are explicitly unconfirmed, not proof of a jailbreak.

The Lab stores evidence in SQLite and already supports summary, regression, provenance and adjudication via the `omjb` CLI. For full analysis and manually reviewed cases, operate the Lab directly through its documented CLI, not by broadening this MCP surface.

## Tests

```bash
node --test modules/omjb-mcp.test.mjs
node --test modules/*.test.mjs
```

The tests construct a temporary evidence store with private sentinel strings and confirm they never appear in MCP responses. The test also checks that SQLite remains unchanged and rejects non-allowlisted tool calls, extra arguments and invalid IDs.

## Security and provenance

- Lab repo and its independent license stay separate. No source dataset or external license is silently bundled.
- The MCP adapter only reads an operator-specified local SQLite file and returns metadata. If the path is absent, it reports unconfigured status.
- Generated or model-supplied text is not trusted as instructions. Do not connect this tool to untrusted network endpoints.
- Evidence and review labels must be interpreted in context. Automated scoring cannot replace human adjudication.
- Features involving actively executing adversarial tests or contacting providers are deliberately **not** part of the read-only plugin.

## Lab execution bridge (early integration)

OMH also includes `plugins/omjb-mcp/lab-server.mjs`, an **optional second MCP server** that calls the Lab's own Python runner. The Lab remains the source of truth: this is an orchestration adapter, not a copy of the Lab's engine.

Set `OMJB_LAB_ROOT` to an absolute path to a trusted checkout of `OpenMind-Jailbreak-Lab`, `OMJB_DB_PATH` to an absolute SQLite evidence DB, and optionally `OMJB_PYTHON` to your interpreter. Register `lab-server.mjs` as a separate local MCP entry (for example `omjb-lab`) using the same registration shape as the evidence server above. No provider keys are required for offline echo tests.

Tools currently exposed:

| Tool | Behavior |
| --- | --- |
| `omjb_lab_capabilities` | Check whether the native Lab is installed and whether live runs are enabled |
| `omjb_lab_run_case` | Run a selected `GL-###` case via `python -m omjb.cli`; supports offline `echo` and explicitly enabled provider targets |
| `omjb_lab_run_campaign` | Launch the Lab's native reviewed-benign multi-provider evaluator with 1–100 request ceiling, finite estimated cost limit, two workers and deadline |

**Live execution is disabled by default.** Only set `OMJB_ALLOW_LIVE_RUNS=1` in a trusted operator-controlled environment when you intend to permit provider calls and associated charges. Campaigns also require an existing reviewed corpus selected by `OMJB_REVIEWED_CORPUS` and an absolute `OMJB_CAMPAIGN_OUTPUT` evidence path. The native Lab checks case eligibility and corpus review constraints. MCP callers cannot provide arbitrary shell commands, raw prompts, corpus paths, or URLs.

This is the **first executable integration**, not a claim that every Lab panel is wired to OMH. Still to integrate: catalog browsing, mutation specifications, offline replay, reviewer workflow and adjudication, guard evaluation, provenance/exports, dashboard screens, and end-to-end iPad packaging. None of those should be marked completed before their own tests pass.

```bash
node --test modules/omjb-lab-mcp.test.mjs
```
