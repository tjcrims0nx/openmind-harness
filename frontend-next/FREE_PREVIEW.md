# Free OMH public UI preview

This branch deploys the `frontend-next` React/OpenUI interface to **GitHub Pages**. No Vercel subscription, Cloudflare account, provider API key or live OMH server is necessary to test the frontend.

### Open it

After the Pages workflow completes and Pages is enabled, the expected project URL is:

`https://tjcrims0nx.github.io/openmind-harness/`

The preview uses the existing OMH logo and a dedicated **PUBLIC UI DEMO** banner. Chat uses canned sample responses; workspace, agents, tasks, memory, workflows, plugins and logs use local example records. **No real AI provider is contacted and no user prompt leaves the browser.**

### Enable deployment once

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open the [Free OMH UI preview workflow](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/openui-free-pages.yml). Once GitHub recognizes the workflow on this branch, use **Run workflow** with `feat/free-openui-pages-preview`, or push another change to that branch.
4. Wait for a successful green deploy-pages step and use the precise URL reported in the job output.

**Keep this preview independent of production.** Pages hosts static Vite output only, not the OMH API, background tasks, MCP services or an Electron installer. Do not enter any real API keys or tokens into the sample preview.

### Future hosted full-stack testing

Cloudflare Pages has a free tier for frontend previews, but a real multi-provider chat also needs a secured backend and your own model/provider credentials. The current Vercel app is separate.
