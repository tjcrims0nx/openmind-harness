#!/usr/bin/env node
// OpenMind Harness — Antigravity sign-in.
//
// Signs in to Google Antigravity (Cloud Code Assist) with your Google
// account, using OAuth 2.0 + PKCE — the same sign-in the Antigravity IDE
// and CLI use. No API key: the Google account IS the credential, and
// requests count against that account's Antigravity quota (Claude and
// Gemini models through Google's Cloud infrastructure).
//
//   node scripts/antigravity-login.mjs           auto: local callback server
//   node scripts/antigravity-login.mjs --manual  headless: paste the redirect URL
//   node scripts/antigravity-login.mjs --refresh  refresh the stored token
//   node scripts/antigravity-login.mjs --status   show sign-in state (no secrets)
//
// Tokens are stored at ~/.config/opencode/antigravity-auth.json (mode 0600):
// access token, refresh token, expiry, your email, and the Google Cloud
// project id the API needs. Override with ANTIGRAVITY_AUTH_FILE.
//
// How it works: the script prints a Google sign-in URL. You sign in in your
// browser and Google sends the code back — either to the local callback
// server (auto mode, port 51121) or as a URL you paste back (manual mode,
// for the iPad guest Terminal and headless machines, where the browser
// cannot reach the local callback).
//
// The OAuth client id below is Antigravity's public client, published in
// open-source Antigravity clients. No client secret is stored or sent:
// PKCE is the credential for a public client, so the code exchange needs
// no secret. No secret, token, or code is ever printed by this script.
//
// After sign-in, the bridge (scripts/antigravity-bridge.mjs) uses these
// tokens. In the harness the Antigravity provider is `antigravity/*`.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile } from "node:child_process";

const CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const API_BASE = "https://cloudcode-pa.googleapis.com";
const REDIRECT_URI = "http://localhost:51121/oauth-callback";
const CALLBACK_PORT = 51121;
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];
const AUTH_FILE =
  process.env.ANTIGRAVITY_AUTH_FILE ||
  path.join(os.homedir(), ".config", "opencode", "antigravity-auth.json");

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthUrl(challenge, state) {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

async function exchangeCode(code, verifier) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${(data.error_description || data.error || "unknown").slice(0, 200)}`);
  }
  return data;
}

async function refreshAccess(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token refresh failed (HTTP ${res.status}): ${(data.error_description || data.error || "unknown").slice(0, 200)}`);
  }
  return data;
}

async function fetchEmail(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return data.email;
}

async function fetchProject(accessToken) {
  const res = await fetch(`${API_BASE}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "google-api-nodejs-client/9.15.1",
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": JSON.stringify({
        ideType: "ANTIGRAVITY",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      }),
    },
    body: JSON.stringify({
      metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return data.cloudaicompanionProject || null;
}

async function fetchModels(accessToken, projectId) {
  const res = await fetch(`${API_BASE}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "antigravity",
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    },
    body: JSON.stringify({ project: projectId }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Object.entries(data.models || {}).map(([id, info]) => ({
    id,
    name: info.displayName || id,
  }));
}

function writeAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function tryOpen(url) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [url], () => {});
}

function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a); }));
}

async function waitForCode(state, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname !== "/oauth-callback") {
        res.writeHead(404); res.end("Not found");
        return;
      }
      const code = u.searchParams.get("code");
      const gotState = u.searchParams.get("state");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Signed in to Antigravity</h1><p>You can close this tab and return to the terminal.</p>");
      server.close();
      if (err) reject(new Error(`Google sign-in error: ${err}`));
      else if (gotState !== state) reject(new Error("State mismatch — sign-in was not started by this script."));
      else if (!code) reject(new Error("No code in the callback."));
      else resolve(code);
    });
    server.on("error", (e) => reject(new Error(`Callback server failed: ${String(e).slice(0, 200)}`)));
    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      log(`Callback server listening on 127.0.0.1:${CALLBACK_PORT}`);
    });
    setTimeout(() => {
      try { server.close(); } catch {}
      reject(new Error("Timed out waiting for the Google sign-in (5 minutes). Run the script again."));
    }, timeoutMs);
  });
}

function log(msg) {
  process.stderr.write(`[antigravity-login] ${msg}\n`);
}

async function finishSignIn(tokens) {
  const auth = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000,
    email: await fetchEmail(tokens.access_token),
    project_id: await fetchProject(tokens.access_token),
  };
  if (auth.project_id) {
    auth.models = await fetchModels(tokens.access_token, auth.project_id);
  }
  writeAuth(auth);
  console.log("Signed in to Antigravity.");
  if (auth.email) console.log(`Account: ${auth.email}`);
  if (auth.project_id) console.log(`Project: ${auth.project_id}`);
  if (auth.models?.length) console.log(`Models available: ${auth.models.map((m) => m.id).join(", ")}`);
  console.log("Tokens stored (mode 0600). The harness Antigravity provider is ready — start the bridge and use antigravity/gemini-3-flash.");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--status")) {
    const auth = readAuth();
    if (!auth) {
      console.log("Antigravity: not signed in. Run: openmind-antigravity-login");
      return;
    }
    console.log(`Antigravity: signed in${auth.email ? ` as ${auth.email}` : ""}.`);
    console.log(`Project: ${auth.project_id || "(unknown)"}`);
    console.log(`Token expires: ${auth.expires_at ? new Date(auth.expires_at).toISOString() : "(unknown)"}`);
    console.log(`Models cached: ${(auth.models || []).map((m) => m.id).join(", ") || "(none yet)"}`);
    return;
  }
  if (args.has("--refresh")) {
    const auth = readAuth();
    if (!auth?.refresh_token) {
      console.log("No stored refresh token. Run: openmind-antigravity-login");
      process.exitCode = 1;
      return;
    }
    const tokens = await refreshAccess(auth.refresh_token);
    auth.access_token = tokens.access_token;
    auth.expires_at = Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000;
    if (tokens.refresh_token) auth.refresh_token = tokens.refresh_token;
    writeAuth(auth);
    console.log("Antigravity token refreshed.");
    return;
  }

  const manual = args.has("--manual");
  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(16));
  const url = buildAuthUrl(challenge, state);
  console.log("Sign in to Google Antigravity with your Google account:");
  console.log("");
  console.log(url);
  console.log("");
  let code;
  if (manual) {
    console.log("After signing in, Google redirects to a localhost URL that cannot load here.");
    console.log("Copy that full redirect URL from your browser address bar and paste it below.");
    const pasted = (await askLine("Redirect URL: ")).trim();
    const u = new URL(pasted);
    if (u.searchParams.get("state") !== state) {
      throw new Error("State mismatch — that redirect did not come from this sign-in. Run the script again.");
    }
    code = u.searchParams.get("code");
    if (!code) throw new Error("No code in the pasted URL.");
  } else {
    tryOpen(url);
    console.log("Waiting for the Google sign-in in your browser (5 minutes)...");
    code = await waitForCode(state);
  }
  const tokens = await exchangeCode(code, verifier);
  await finishSignIn(tokens);
}

main().catch((e) => {
  console.error(`[antigravity-login] ERROR: ${String(e?.message || e).slice(0, 500)}`);
  process.exit(1);
});
