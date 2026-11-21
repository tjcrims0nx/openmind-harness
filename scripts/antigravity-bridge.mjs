#!/usr/bin/env node
// OpenMind Harness — Antigravity bridge.
//
// Translates OpenAI-compatible chat requests (what the harness speaks) into
// Google Antigravity's own API (Cloud Code Assist, cloudcode-pa) and back.
// The harness's `antigravity` provider points at this bridge on loopback;
// the bridge is the only piece that talks to Google.
//
//   Listens:  http://127.0.0.1:18080  (loopback only, never exposed)
//   Auth:     OAuth tokens from the Antigravity sign-in, stored by
//             scripts/antigravity-login.mjs at
//             ~/.config/opencode/antigravity-auth.json (mode 0600).
//             Override with ANTIGRAVITY_AUTH_FILE. The bridge refreshes
//             an expired access token itself using the stored refresh token.
//   Models:   GET /v1/models lists the configured models (default
//             gemini-3-flash; the sign-in also caches the models your
//             Google account can use).
//
// No dependencies — Node's built-ins only. Run it with:
//   node scripts/antigravity-bridge.mjs
// Stop it with Ctrl-C. It logs one line per request to stderr.
//
// The bridge never stores a credential in the repo and never prints a token.
// If you are not signed in, chat calls fail with a clear "not signed in"
// error telling you to run the login script — they never fail silently.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.ANTIGRAVITY_BRIDGE_PORT || 18080);
const HOST = "127.0.0.1";
const AUTH_FILE =
  process.env.ANTIGRAVITY_AUTH_FILE ||
  path.join(os.homedir(), ".config", "opencode", "antigravity-auth.json");
const CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://cloudcode-pa.googleapis.com";
const USER_AGENT = "antigravity";

// Models the bridge offers when the sign-in has not cached a list yet.
const DEFAULT_MODELS = [{ id: "gemini-3-flash", name: "Gemini 3 Flash" }];

function log(msg) {
  process.stderr.write(`[antigravity-bridge] ${msg}\n`);
}

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

function isExpired(auth) {
  return !auth.access_token || !auth.expires_at || Date.now() > auth.expires_at - 5 * 60 * 1000;
}

async function refreshToken(auth) {
  if (!auth.refresh_token) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.refresh_token,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const next = {
    ...auth,
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
  if (data.refresh_token) next.refresh_token = data.refresh_token;
  writeAuth(next);
  return next;
}

async function getAuth() {
  let auth = readAuth();
  if (!auth) return null;
  if (isExpired(auth)) {
    auth = await refreshToken(auth);
    if (!auth) return null;
  }
  return auth;
}

function notSignedIn(res) {
  const body = JSON.stringify({
    error: {
      message:
        "Antigravity is not signed in. Run: openmind-antigravity-login (or: node scripts/antigravity-login.mjs) and sign in with your Google account.",
      type: "not_signed_in",
      code: "not_signed_in",
    },
  });
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(body);
}

// --- OpenAI messages -> Antigravity (Gemini-shaped) request -----------------

function toParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return { text: p };
        if (p && p.type === "text") return { text: p.text || "" };
        if (p && p.type === "image_url") return null; // images not passed through
        return null;
      })
      .filter(Boolean);
  }
  return [{ text: String(content ?? "") }];
}

function toContents(messages) {
  const contents = [];
  const systemTexts = [];
  for (const m of messages || []) {
    if (m.role === "system") {
      systemTexts.push(...toParts(m.content).map((p) => p.text));
      continue;
    }
    if (m.role === "tool") {
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: m.tool_call_id || "tool",
              response: { result: typeof m.content === "string" ? m.content : JSON.stringify(m.content) },
            },
          },
        ],
      });
      continue;
    }
    const parts = toParts(m.content);
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: tc.function?.name || "tool", args } });
      }
    }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return { contents, systemTexts };
}

function toTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const decls = [];
  for (const t of tools) {
    if (t?.type === "function" && t.function?.name) {
      decls.push({
        name: t.function.name,
        description: t.function.description || "",
        parameters: t.function.parameters || { type: "object", properties: {} },
      });
    }
  }
  return decls.length ? [{ functionDeclarations: decls }] : undefined;
}

function buildEnvelope(body, auth) {
  const { contents, systemTexts } = toContents(body.messages);
  const request = { contents };
  if (systemTexts.length) {
    request.systemInstruction = { parts: [{ text: systemTexts.join("\n\n") }] };
  }
  const generationConfig = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.max_tokens !== undefined) generationConfig.maxOutputTokens = body.max_tokens;
  if (body.top_p !== undefined) generationConfig.topP = body.top_p;
  if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (Object.keys(generationConfig).length) request.generationConfig = generationConfig;
  const tools = toTools(body.tools);
  if (tools) request.tools = tools;
  return {
    project: auth.project_id,
    model: body.model,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

// --- Antigravity SSE -> OpenAI chunks ----------------------------------------

function sseTextLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) out.push(line.slice(5).trim());
  }
  return out;
}

function partsToDelta(parts, callIndex) {
  // Returns {content, toolCalls, finish} for one candidate's parts.
  let content = "";
  const toolCalls = [];
  for (const part of parts || []) {
    if (typeof part.text === "string") content += part.text;
    if (part.functionCall) {
      toolCalls.push({
        index: callIndex + toolCalls.length,
        id: `call_${Date.now().toString(36)}${toolCalls.length}`,
        type: "function",
        function: {
          name: part.functionCall.name || "",
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }
  return { content, toolCalls };
}

function openaiChunk(model, delta, finishReason) {
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason || null }],
  };
}

async function handleChat(req, res, body) {
  const auth = await getAuth();
  if (!auth) return notSignedIn(res);
  if (!auth.project_id) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: "Antigravity sign-in is incomplete (no project). Run openmind-antigravity-login again.",
          type: "not_signed_in",
          code: "not_signed_in",
        },
      })
    );
    return;
  }
  const envelope = buildEnvelope(body, auth);
  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": JSON.stringify({
          ideType: "ANTIGRAVITY",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
        }),
      },
      body: JSON.stringify(envelope),
    });
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Could not reach Antigravity: ${String(e).slice(0, 200)}`, type: "upstream_error" } }));
    return;
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    let message = `Antigravity returned HTTP ${upstream.status}.`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) message = parsed.error.message;
    } catch {
      if (text) message = text.slice(0, 300);
    }
    if (upstream.status === 401) message += " Sign in again: openmind-antigravity-login.";
    res.writeHead(upstream.status === 401 ? 401 : 502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message, type: "upstream_error" } }));
    return;
  }

  const stream = body.stream !== false;
  const model = body.model;
  const raw = await upstream.text();
  const events = [];
  for (const line of sseTextLines(raw)) {
    if (!line || line === "[DONE]") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore malformed SSE lines
    }
  }
  // Each event is {response: {candidates, usageMetadata}, ...}
  let fullContent = "";
  const fullToolCalls = [];
  let finishReason = "stop";
  let promptTokens = 0;
  let completionTokens = 0;
  const chunks = [];
  for (const ev of events) {
    const resp = ev.response || ev;
    const cand = resp.candidates?.[0];
    if (!cand) continue;
    if (resp.usageMetadata) {
      promptTokens = resp.usageMetadata.promptTokenCount || promptTokens;
      completionTokens = resp.usageMetadata.candidatesTokenCount || completionTokens;
    }
    const { content, toolCalls } = partsToDelta(cand.content?.parts, fullToolCalls.length);
    if (content) fullContent += content;
    if (toolCalls.length) {
      fullToolCalls.push(...toolCalls);
      finishReason = "tool_calls";
    }
    if (cand.finishReason && cand.finishReason !== "STOP") finishReason = "stop";
    if (stream) {
      const delta = {};
      if (content) delta.content = content;
      if (toolCalls.length) delta.tool_calls = toolCalls;
      chunks.push(openaiChunk(model, delta, null));
    }
  }
  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.write(`data: ${JSON.stringify(openaiChunk(model, {}, finishReason))}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    const message = { role: "assistant", content: fullContent || null };
    if (fullToolCalls.length) message.tool_calls = fullToolCalls;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `chatcmpl-${Date.now().toString(36)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message, finish_reason: finishReason }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      })
    );
  }
  log(`chat model=${model} finish=${finishReason} in=${promptTokens} out=${completionTokens}`);
}

function listModels(auth) {
  const cached = Array.isArray(auth?.models) ? auth.models : [];
  const seen = new Set();
  const data = [];
  for (const m of [...cached, ...DEFAULT_MODELS]) {
    const id = typeof m === "string" ? m : m.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    data.push({ id, object: "model", owned_by: "antigravity", created: 0 });
  }
  return { object: "list", data };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const auth = readAuth();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, signed_in: !!auth, email: auth?.email || null }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(listModels(readAuth())));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      await handleChat(req, res, body);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found", type: "not_found" } }));
  } catch (e) {
    log(`error: ${String(e).slice(0, 300)}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Bridge error", type: "bridge_error" } }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} (loopback only)`);
});

// Self-test: node scripts/antigravity-bridge.mjs --self-test
// Checks the request/response translation on fixtures. No network, no auth.
if (process.argv.includes("--self-test")) {
  const failures = [];
  const check = (name, cond) => {
    if (!cond) failures.push(name);
    process.stderr.write(`[self-test] ${cond ? "PASS" : "FAIL"} ${name}\n`);
  };
  // 1. OpenAI request -> Antigravity envelope.
  const env = buildEnvelope(
    {
      model: "gemini-3-flash",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Say only ok." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
      temperature: 0.5,
    },
    { project_id: "test-project" }
  );
  check("envelope has project", env.project === "test-project");
  check("envelope has model", env.model === "gemini-3-flash");
  check("envelope requestType is agent", env.requestType === "agent");
  check("system becomes systemInstruction", env.request.systemInstruction?.parts?.[0]?.text === "Be brief.");
  check("user becomes contents", env.request.contents?.[0]?.role === "user");
  check("tools become functionDeclarations", env.request.tools?.[0]?.functionDeclarations?.[0]?.name === "read_file");
  check("temperature passes through", env.request.generationConfig?.temperature === 0.5);
  // 2. Antigravity SSE -> OpenAI chunks.
  const sse =
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello "}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}}\n\n' +
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"world"}]}}]}}\n\n' +
    'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"/tmp/x"}}}]},"finishReason":"STOP"}]}}\n\n';
  let content = "";
  let calls = 0;
  for (const line of sseTextLines(sse)) {
    if (!line) continue;
    const ev = JSON.parse(line);
    const d = partsToDelta(ev.response.candidates[0].content.parts, calls);
    content += d.content;
    calls += d.toolCalls.length;
  }
  check("SSE text unwraps in order", content === "Hello world");
  check("SSE functionCall becomes a tool call", calls === 1);
  const chunk = openaiChunk("gemini-3-flash", { content: "hi" }, null);
  check("OpenAI chunk shape", chunk.object === "chat.completion.chunk" && chunk.choices[0].delta.content === "hi");
  if (failures.length) {
    process.stderr.write(`[self-test] ${failures.length} FAILURES\n`);
    process.exit(1);
  }
  process.stderr.write("[self-test] all checks passed\n");
  process.exit(0);
}
