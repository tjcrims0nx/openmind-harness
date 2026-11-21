// OpenMind Guard — the harness's own tool-call guard plugin.
//
// What it does (all on by default, no configuration):
//   1. tool.execute.before — DENIES (by throwing) three classes of tool call:
//      - catastrophic shell commands (rm -rf on /, mkfs, dd to a device,
//        fork bomb, chmod/chown -R on /, shutdown/reboot) via the `bash` tool.
//      - web fetches to non-http(s) schemes or to loopback / private /
//        link-local / cloud-metadata hosts (SSRF guard) via `webfetch`.
//      - reads/edits/writes of credential files (auth.json, ~/.ssh,
//        ~/.gnupg, *.pem/*.p12/*.mobileprovision) via `read`/`edit`/`write`.
//   2. tool.execute.after — appends one JSON line per tool call to
//      ~/.local/share/opencode/openmind-guard.log (append-only, values that
//      look like secrets are redacted). Never throws.
//
// What it does NOT cover (documented limits):
//   - MCP tool calls and task-spawned subagent tool calls do not fire
//     tool.execute.before in OpenCode 1.x (upstream limitation,
//     sst/opencode#5894). Those are governed by the config `permission`
//     map instead.
//   - Commands the user types directly with `!` in the TUI bypass plugins.
//   - The web UI's permission prompts (allow/ask/deny) are a separate,
//     complementary layer: the plugin is a hard deny, the UI prompt is
//     a per-call approval.
//
// Plain JavaScript, no imports, no npm dependency. OpenCode 2.x loads it
// from the `"plugins": ["./plugins/openmind-guard"]` entry in opencode.json
// (relative to the config file); the setup scripts and the iOS guest image
// install it to the plugin discovery directory, so it activates on the
// OpenCode 2.x upgrade with no change needed. On OpenCode 1.19.6 (V1) the
// `plugins` config key is not supported and local plugin discovery does
// not load it — the guard is present but dormant there, and the config
// `permission` map is the live layer. See docs/features.md.

const CATASTROPHIC_BASH = [
  // rm -rf on /, /*, ~, or $HOME
  /\brm\b[^;&|]*-[a-z]*r[a-z]*f\b[^;&|]*(\s\/(\s|$|\*)|\s~(\s|$|\/)|\s\$HOME(\s|$|\/))/i,
  /\brm\b[^;&|]*--no-preserve-root\b/i,
  // filesystem / device destruction
  /\bmkfs\b/i,
  /\bdd\b[^;&|]*\bof=\/dev\//i,
  />\s*\/dev\/(sd|hd|nvme|vd)[a-z0-9]*/i,
  /\bchmod\b[^;&|]*-R\b[^;&|]*\s\/(\s|$)/i,
  /\bchown\b[^;&|]*-R\b[^;&|]*\s\/(\s|$)/i,
  // fork bomb
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  // power control (rebooting the guest / host is never a coding task)
  /(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)\b/i,
];

const CREDENTIAL_PATH = /(^|\/)\.config\/opencode\/auth\.json$|(^|\/)\.ssh(\/|$)|(^|\/)\.gnupg(\/|$)|\.(pem|p12|mobileprovision)$/i;

function isPrivateHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "metadata.google.internal") return true;
  const parts = h.split(".").map((p) => Number(p));
  if (parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[REDACTED]")
    .replace(/(xpl_[0-9a-f]{8,})/g, "[REDACTED]")
    .replace(/(sk-ant-[A-Za-z0-9_-]{8,})/g, "[REDACTED]")
    .replace(/([A-Za-z0-9_-]*api[_-]?key["'\s:=]+)(["'][^"']+["']|[^\s"',}]+)/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/g, "$1[REDACTED]");
}

function denyReason(tool, detail) {
  return `OpenMind Guard: blocked ${tool} — ${detail}. Disable the plugin in opencode.json ("plugins") to allow it.`;
}

export default async function OpenMindGuard() {
  return {
    tool: {
      execute: {
        before: async (input, output) => {
          const tool = input.tool;
          const args = (output && output.args) || {};
          if (tool === "bash") {
            const command = String(args.command || "");
            for (const pattern of CATASTROPHIC_BASH) {
              if (pattern.test(command)) {
                throw new Error(denyReason("bash", `catastrophic command matched ${pattern}`));
              }
            }
          }
          if (tool === "webfetch") {
            const url = String(args.url || "");
            let parsed;
            try {
              parsed = new URL(url);
            } catch {
              throw new Error(denyReason("webfetch", `not a valid URL: ${url}`));
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              throw new Error(denyReason("webfetch", `scheme ${parsed.protocol} is not http(s)`));
            }
            if (isPrivateHost(parsed.hostname)) {
              throw new Error(denyReason("webfetch", `host ${parsed.hostname} is loopback/private/link-local/metadata`));
            }
          }
          if (tool === "read" || tool === "edit" || tool === "write") {
            const filePath = String(args.filePath || args.path || "");
            if (CREDENTIAL_PATH.test(filePath)) {
              throw new Error(denyReason(tool, `credential file ${filePath} is not readable by the agent`));
            }
          }
        },
        after: async (input, output) => {
          try {
            const fs = await import("node:fs");
            const os = await import("node:os");
            const path = await import("node:path");
            const logDir = path.join(os.homedir(), ".local", "share", "opencode");
            const logFile = path.join(logDir, "openmind-guard.log");
            fs.mkdirSync(logDir, { recursive: true });
            const record = {
              ts: new Date().toISOString(),
              tool: input.tool,
              args: redact(JSON.stringify((output && output.args) || {})),
              result: typeof output === "object" && output !== null && "result" in output
                ? redact(String(output.result).slice(0, 500))
                : undefined,
            };
            fs.appendFileSync(logFile, JSON.stringify(record) + "\n");
          } catch {
            // Logging is best-effort and must never break a tool call.
          }
        },
      },
    },
  };
}
