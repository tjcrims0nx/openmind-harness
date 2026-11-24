# OpenUI primary frontend

OpenUI is the primary chat-first interface for the built OMH desktop and local dashboard, with black and neon purple styling. The classic dashboard remains at `/classic`; if the OpenUI build is missing, the classic interface is the fallback.

It uses the OpenUI `MarkDownRenderer` and `ThemeProvider` from `@openuidev/react-ui` 0.18.12, based on the user's [openui](https://github.com/tjcrims0nx/openui) fork (upstream [Thesys OpenUI](https://github.com/thesysdev/openui)). These packages are MIT-licensed; retain upstream attributions when distributing their source. The chat transport intentionally stays OMH's existing authenticated JSON `/api/chat` endpoint rather than pretending it is OpenUI's streaming format.

## Development

Requires Node.js 22.12+ and the OMH local dashboard running at `127.0.0.1:4177`:

```sh
node scripts/omh-dashboard.mjs # from the repository root, separate terminal
cd frontend-next
npm install
npm run dev
```

Open `http://127.0.0.1:5180`. Vite proxies `/api/*` to the loopback dashboard. Configure provider credentials in the **server environment**, not React. The selected model controls the provider adapter through the existing validated `/api/chat` route. 

Build the static client:

```sh
npm run build
```

The script copies `../dashboard/app-icon.webp`, the official OMH emblem, into the generated frontend public assets. Do not commit the copied binary or any provider secrets.

## Current scope

- Proper mobile-sized chat with an always-visible composer, responsive navigation, provider selection, in-memory message history and OpenUI markdown rendering.
- Explicit connection control for remote dashboard tokens; model keys stay on the server.
- The interface uses existing authenticated runtime APIs and includes the opt-in read-only evidence plugin controls.
- OpenUI supports streamed messages and generative components, but OMH's current JSON chat endpoint returns a final response. Actual token streaming and model-driven components require a separately verified server protocol; this release does not claim those capabilities.
- Workspace, Agents, Tasks, Memory, Workflows, Plugins and Logs now read actual metadata from the authenticated `/api/state` endpoint. Runtime metadata views fail visibly if disconnected. Evidence plugin enable, disable and retry are separately authorized administrative operations; other privileged actions remain subject to existing runtime permissions.
- Authored React UI and styles are original OMH code; no OpenUI source files are copied into this repository.

## Release verification

Build with `npm run build` and run desktop/mobile browser smoke tests and module CI before publishing changes. Verify authenticated runtime routes, explicit provider selection, read-only evidence plugin lifecycle, and clean shutdown. The beta baseline is `c7f254e`; see the [release](https://github.com/tjcrims0nx/openmind-harness/releases/tag/v0.1.0-beta.1).
