# OpenUI frontend pilot

This is a **separate React/OpenUI replacement candidate** for the OMH website and Electron desktop shell. It does not replace the working production frontend until its build and browser tests pass.

It uses the OpenUI `MarkDownRenderer` and `ThemeProvider` from `@openuidev/react-ui` 0.18.12, based on the user's [openui](https://github.com/tjcrims0nx/openui) fork (upstream [Thesys OpenUI](https://github.com/thesysdev/openui)). These packages are MIT-licensed; retain upstream attributions when distributing their source. The chat transport intentionally stays OMH's existing authenticated JSON `/api/chat` endpoint rather than pretending it is OpenUI's streaming format.

## Development

Requires Node.js 22.12+ and the OMH local dashboard running at `127.0.0.1:4177`:

```sh
node scripts/omh-dashboard.mjs # from the repository root, separate terminal
cd frontend-next
npm install
npm run dev
```

Open `http://127.0.0.1:5180`. Vite proxies `/api/*` to the loopback dashboard. Configure provider credentials in the **server environment**, not React. The selected model controls the provider adapter through the existing validated `/api/chat` route. For a deployed remote client, configure `OMH_WEB_ACCESS_TOKEN` and server-side provider API keys in Vercel, and serve the compiled frontend from the same origin as `/api/chat`.

Build the static client:

```sh
npm run build
```

The script copies `../dashboard/app-icon.webp`, the official OMH emblem, into the generated frontend public assets. Do not commit the copied binary or any provider secrets.

## Current scope

- Proper mobile-sized chat with an always-visible composer, responsive navigation, provider selection, in-memory message history and OpenUI markdown rendering.
- Explicit connection control for remote dashboard tokens; model keys stay on the server.
- Existing Harness modules, MCP and dashboard remain unchanged; this is a replacement candidate until integrated and tested.
- OpenUI supports streamed messages and generative components, but OMH's current JSON chat endpoint returns a final response. Actual token streaming and model-driven components require a separately verified server protocol; this pilot does not claim those capabilities.
- Workspace/Agents/Tasks/etc navigation is a placeholder. It must be integrated with the existing authenticated OMH runtime views before rollout.
- Authored React UI and styles are original OMH code; no OpenUI source files are copied into this repository.

## Rollout gate

Pass `npm run build` and browser tests at 390px and 1440px, verify real hosted/provider and local CSRF paths, and connect the missing runtime views. **Do not switch Vercel or Electron to this UI until these checks succeed.**
