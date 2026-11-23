# OpenMind Jailbreak Lab — MCP evidence plugin

This optional **read-only MCP integration** connects the independent [OpenMind Jailbreak Lab](https://github.com/tjcrims0nx/OpenMind-Jailbreak-Lab) evidence database with OpenMind Harness / OpenCode. It does **not** copy the lab's prompt corpus or execute test campaigns. It is opt-in and disabled unless you register it yourself.

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
