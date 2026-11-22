# OpenMind Harness · Live Vercel + MCP test connector

This is an **experimental live connection**, not a replacement for the Linux harness. Vercel hosts the existing OMH cyberpunk dashboard and its API; a trusted Linux machine runs OpenCode, persistent JSON stores, queues, agents, and Bubblewrap. The web UI can inspect the real runtime and issue *restricted* changes. The same Vercel deployment exposes an authenticated, stateless JSON-RPC MCP endpoint for compatible clients.

## Architecture

```
Browser (access token entered per browser session)
    |
    | HTTPS /api/state, /api/actions
    v
Vercel frontend + serverless API (/api/mcp too)
    |  private server-side OMH_LIVE_TOKEN; never sent to browser
    |  HTTPS through a trusted TLS tunnel
    v
Linux localhost:4188  (scripts/omh-live.mjs)
    |  read actual .omh state / call existing read-mostly MCP bridge
    v
OMH daemon, OpenCode, queues, memory, workers, Bubblewrap
```

The live gateway binds **127.0.0.1 only** and requires a strong bearer token. Configure a secure, stable HTTPS tunnel or an authenticated reverse proxy to this local port. `OMH_LIVE_URL` must be an externally reachable HTTPS origin: Vercel cannot access `127.0.0.1` on your Linux host. Do not open the Linux service directly to the Internet or expose a private network without strong access controls.

## Run the Linux side

From a checked-out harness on the Linux host with Node.js 22+:

```sh
# Configure OMH_WORKSPACE and OMH_STATE_DIR to match your existing worker.
export OMH_WORKSPACE="$HOME/omh-workspace"
export OMH_STATE_DIR="$OMH_WORKSPACE/.omh"
export OMH_LIVE_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
node scripts/omh-live.mjs
```

Keep this process and the OMH daemon supervised as long-running Linux services. Store the token in the process manager's secret environment, not in Git, shell history, or an agent prompt. `OMH_LIVE_PORT` defaults to **4188**. In another trusted terminal, confirm a local authenticated response:

```sh
curl -fsS -H "Authorization: Bearer $OMH_LIVE_TOKEN" http://127.0.0.1:4188/health
```

## Configure Vercel

Link the `tjcrims0nx/openmind-harness` Git repository to a **separate Vercel project**, preserving the existing dashboard and Linux worker. The repo contains `vercel.json`, `api/` functions, and the static dashboard build. Set these three Vercel environment variables in the project settings:

| Secret | Purpose |
| --- | --- |
| `OMH_LIVE_URL` | Trusted HTTPS tunnel origin pointing at Linux port 4188, e.g. `https://your-private-runtime.example.com` |
| `OMH_LIVE_TOKEN` | Exactly the same **strong secret** used on Linux; never exposed in browser responses |
| `OMH_WEB_ACCESS_TOKEN` | A **different** random secret of at least 32 bytes; enter it in the dashboard's access prompt |

Redeploy after configuring the variables. Vercel Deployment Protection is strongly recommended. Do **not** disable authentication or put the token in a public `NEXT_PUBLIC_*` value. Unconfigured previews are intentionally disconnected: API calls return 503 rather than showing fabricated runtime data.

The dashboard keeps the web access token only in page memory; reloading the page asks again. The server-side `OMH_LIVE_TOKEN` is never included in page HTML or JavaScript.

## Live controls (test scope)

Supported remote actions are **cancel queued task, retry failed read-only task, pause schedule, disable plugin, and reject skill proposal**. Only the local trusted worker actually processes queued work. The Vercel bridge does not permit enabling plugins, approving skills, resuming schedules, arbitrary commands, or native agent launches. Keep privileged review on the trusted local dashboard/CLI.

## Remote MCP test endpoint

For clients that support stateless HTTP JSON-RPC MCP:

- URL: `https://<your-vercel-domain>/api/mcp`
- Header: `Authorization: Bearer <OMH_WEB_ACCESS_TOKEN>`
- Method: `POST`, JSON-RPC 2.0, with `initialize`, `tools/list`, and `tools/call`

The remote MCP endpoint passes through the already-restricted `omh-mcp.mjs` tool list: status, health diagnostics, approved memory search, task list, read-only queued inspection, trace summaries, skill proposals, and informational agent mailboxes. No shell/approval tool is available. It is **not** a fully validated event-streaming MCP transport; compatibility with a specific remote client should be tested before calling it production-ready.

Example handshake from a trusted client:

```sh
curl -fsS -X POST 'https://<your-vercel-domain>/api/mcp' \
  -H "Authorization: Bearer $OMH_WEB_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"omh-test","version":"1.0"}}}'
```

The shared repository `opencode.json` continues to configure a **local stdio MCP server** through `scripts/install-omh-runtime.mjs`; the remote endpoint is separate, avoiding circular calls and hard-coded Vercel URLs. Current OpenCode versions may have remote-header interpolation bugs, so verify the actual outgoing auth header in an isolated test; never commit a token to `opencode.json`.

## Limits

This proof-of-concept does **not** move Bubblewrap, Linux daemons, the queue database, or private provider keys to Vercel Functions. Those require persistent local Linux processes. A live Vercel deployment with no connected Linux URL is just a disconnected frontend. The bridge's HTTP tests verify protocol behavior and access restrictions; actual connectivity additionally depends on the HTTPS tunnel and Vercel environment configuration. Cloud-connected exposure requires security review before managing sensitive workloads.
