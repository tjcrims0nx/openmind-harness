# OMH free hosted full-stack test (Cloudflare)

This branch deploys the **actual React/OpenUI frontend and a real, authenticated multi-provider chat API together** in one Cloudflare Worker with Static Assets. It supersedes the old *GitHub Pages static demo* workflow. The public site is **not** a fake reply generator: on Cloudflare, it calls `/api/chat` on its own origin.

The deployment is free-tier eligible, subject to Cloudflare's limits. Third-party model provider requests may have their own usage charges. The complete OpenMind Harness daemon, OpenCode executable and persistent agent process **do not run inside Workers**. For real task/agent/runtime data, configure a separate HTTPS-hosted OMH gateway (`OMH_LIVE_URL` and `OMH_LIVE_TOKEN`); otherwise runtime views accurately say the backend is offline.

## 1. Revoke the exposed Cloudflare token

The Cloudflare API token shared in a chat must be treated as compromised. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), revoke it, and create a new **scoped Workers deployment token** limited to the OMH account. Do not paste the replacement into ChatGPT, PRs, issues or repository files. Cloudflare recommends account-scoped Workers editing permissions.

## 2. Save GitHub Actions secrets

Go to **[OMH Actions secrets](https://github.com/tjcrims0nx/openmind-harness/settings/secrets/actions)** and choose **New repository secret** twice:

- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID (account identifier, not a password).
- `CLOUDFLARE_API_TOKEN` — the **newly rotated** scoped deployment token.

Neither value is printed by the workflow. Do **not** store any model provider API key as a public React environment variable.

## 3. Build and deploy

The [Cloudflare CI workflow](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/openui-cloudflare.yml) triggers when the preview branch receives a commit. It tests the Worker, builds the React app, then invokes Wrangler using GitHub Actions secrets. You may also run it manually after the workflow is registered on the default branch.

The Worker is named **`omh-openui-test`** by `wrangler.jsonc`. After a green deployment, find the real `*.workers.dev` URL in the deploy logs or Cloudflare dashboard. Do not guess it from the account ID.

The public browser app and backend share one origin, so no cross-origin token proxy is necessary.

## 4. Configure real chat without exposing secrets

On Cloudflare, select **Workers & Pages → omh-openui-test → Settings → Variables and Secrets**, and add **Secret** bindings:

- `OMH_WEB_ACCESS_TOKEN`: a **new** random value of at least 32 characters, distinct from the Cloudflare deployment API token.
- At least one model provider key, for example `GEMINI_API_KEY`, `OPENROUTER_API_KEY` or `OPENAI_API_KEY`. Supported others: `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `ZAI_API_KEY`, `MOONSHOT_API_KEY`, `DASHSCOPE_API_KEY`.

Do not use `CLOUDFLARE_API_TOKEN` as a chat access token. After saving secrets, open the hosted OMH site, tap **Connect**, paste the *dashboard access token* and explicitly choose a model. Conversations are sent to the selected real provider, not simulated locally.

Optional validated model overrides use `OMH_CHAT_<PROVIDER>_MODEL`, such as `OMH_CHAT_GEMINI_MODEL`. An invalid or unavailable provider model can return an upstream error; verify each model against your own provider account.

## 5. Real Harness runtime (optional, separate)

The Worker supports a read-only `GET /api/state` bridge. Provide **both** `OMH_LIVE_URL` (public HTTPS endpoint of your running gateway) and `OMH_LIVE_TOKEN` (separate gateway bearer secret). It refuses local/private IP URLs and HTTPS credentials in the URL. **Do not point this at the chat API itself.**

This backend is for browser chat and remote runtime telemetry, **not** general-purpose remote execution or long-running local agents. Leave remote runtime settings unset if you only need multi-provider chat testing.

## Verification

Run in repository root:

```sh
node --check workers/openui-backend.mjs
node --test workers/openui-backend.test.mjs
cd frontend-next
npm install
npm run build
```

CI performs these checks before any authenticated deployment. A **green CI build does not prove your personal provider key, quota, model access or external Harness runtime is functioning**; after the Worker is deployed, test a real provider and check the response/status.

The branch stays isolated pending review, so OMH production Vercel and the Electron UI are not changed.
