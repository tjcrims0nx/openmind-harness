# OpenMind Jailbreak Lab — MCP integration (evidence + execution bridge)

This optional integration connects the independent [OpenMind Jailbreak Lab](https://github.com/tjcrims0nx/OpenMind-Jailbreak-Lab) to OMH / OpenCode through **two complementary MCP servers**:

- **Evidence bridge** (`server.mjs`) — strictly read-only access to aggregate run results, comparisons and pending reviews. No raw prompts, responses, private notes or credentials are returned.
- **Execution bridge** (`lab-server.mjs`) — launches selected Guardrail Lab cases or bounded, reviewed-benign multi-provider campaigns using the Lab's own Python engine. It is separately registered and **live model calls are disabled by default**.

The complete Lab workflow remains an integration goal; these bridges are an initial operational foundation rather than a finished all-in-one UI.

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

The **evidence server's** calls are schema-validated and invoke a **fixed** Python helper in SQLite query-only mode. The evidence server does not launch campaigns or models; the separately configured execution server described below can perform approved runs. Heuristic flags are explicitly unconfirmed, not proof of a jailbreak.

The Lab stores evidence in SQLite and already supports summary, regression, provenance and adjudication via the `omjb` CLI. For detailed analysis or reviewer workflows not yet exposed through OMH, use the Lab's documented CLI.

## Tests

```bash
node --test modules/omjb-mcp.test.mjs
node --test modules/*.test.mjs
```

The read-only tests construct a temporary evidence store with private sentinel strings and confirm they never appear in MCP responses. The test also checks that SQLite remains unchanged and rejects non-allowlisted tool calls, extra arguments and invalid IDs.

## Security and provenance

- Lab repo and its independent license stay separate. No source dataset or external license is silently bundled.
- The evidence adapter only reads an operator-specified SQLite file and returns metadata. The separately enabled execution adapter can write run results using the Lab's own CLI.
- Generated or model-supplied text is not trusted as instructions. Do not connect this tool to untrusted network endpoints.
- Evidence and review labels must be interpreted in context. Automated scoring cannot replace human adjudication.
- The evidence server never runs prompts; the execution server can run approved campaigns only with the operator's explicit configuration and bounded limits.

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
