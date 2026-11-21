# OpenMind Harness

OpenMind Harness brings a coding workspace to iPhone and iPad. The app boots an Alpine Linux guest on the device, starts the workspace server on loopback, and opens it in a native web view. The terminal and workspace run locally. Model requests go to the configured provider.

| Target | Runtime | Entry point |
| --- | --- | --- |
| iPhone and iPad release | Native shell, iSH-ARM64 and the packaged DeepSeek Harness runtime | [iOS workspace](ios/workspace) |
| Linux and Android (Termux) | OpenCode with a shared provider configuration | [Linux installer](linux-setup.sh) · [Termux installer](termux-setup.sh) |
| Standalone chat preview | OpenMind’s Python engine with an OpenAI-compatible endpoint | [OpenMind launcher](openmind-harness) |

## Run on iPhone or iPad

1. Open the [unsigned IPA workflow](https://github.com/tjcrims0nx/openmind-harness/actions/workflows/build-ipa.yml). Choose a successful run for the revision you want to install. For a manual build, select the branch before starting the workflow.
2. Download the IPA artifact, extract it, then sign and sideload the app with your Apple development credentials.
3. Launch **OpenMind Harness** and let it import the guest image on first boot. When the workspace opens, configure your provider in the guest workspace.
4. Open the terminal from the control bar to work in the same guest. The menu provides server logs and a restart action.

The release target uses the workspace sandbox and asks for tool approval. Commands that require sandbox features unavailable in the emulator may fail. The [component notices](ios/workspace/LICENSE.md) identify the upstream software packaged with the app.

### Build from source

On an Apple Silicon Mac with Xcode, Meson, Ninja, LLVM LLD, Node.js, npm and the Ruby `xcodeproj` gem, run these commands from the repository root:

```sh
make -C ios/workspace emulator
ninja -C ios/ish-arm64/build-arm64-release tools/fakefsify
make -C ios/workspace rootfs
make -C ios/workspace project
open ios/workspace/DSH.xcodeproj
```

Select your signing team and device in Xcode. The [release workflow](.github/workflows/build-ipa.yml) contains the unsigned build and simulator smoke-test commands. The project one directory higher, `ios/DSH.xcodeproj`, is the standalone engine preview.

## OpenCode on Linux and Termux

From a clone of this repository, run `bash linux-setup.sh` on Linux or `bash termux-setup.sh` inside Termux. The installer launches the web UI. Use `--no-launch` to install only, or run `opencode web` to start it later.

These installers use [opencode.json](opencode.json), which defines 18 provider entries, including local servers and custom endpoints. Provider availability depends on the selected model and your credentials. Connect a provider in OpenCode or use its supported environment variable. For a custom endpoint, run `openmind-set-custom-endpoint` and enter the URL, bearer key and model ID in the terminal. Load the saved settings with `. ~/.config/opencode/.env` before launching OpenCode from that shell.

See the [OpenCode feature guide](docs/features.md) for agent configuration and the [evaluation guide](eval/README.md) for the coding-task runner.

## Standalone OpenMind engine

The Python launcher supports one-shot prompts, interactive chat and a local browser workspace. Set `OPENAI_API_KEY` for the default OpenAI endpoint, or supply your endpoint with `--base-url` and its key with `OPENMIND_CUSTOM_API_KEY`. Replace the example model ID with one your provider serves.

```sh
./openmind-harness --model "your-model-id" "Hello"
./openmind-harness --model "your-model-id"
./openmind-harness --web --model "your-model-id"
```

In web mode, open the loopback URL printed by the launcher. Tabs share one conversation until the server exits. In terminal mode, type `/exit` to end the session.

## License

See [LICENSE](LICENSE) and the [third-party component notices](LICENSE.md).
