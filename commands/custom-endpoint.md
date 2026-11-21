---
description: Set your own API — save a custom endpoint URL and bearer key for the Custom endpoint provider
agent: general
---

Set the user's own API endpoint (a base URL and a bearer key) for the
harness's Custom endpoint provider.

Ask the user for the three values if they did not give them: the API
base URL (an OpenAI-compatible endpoint, e.g.
https://api.example.com/v1), the bearer key for it, and a model id that
API serves (e.g. deepseek-v4.1-flash:free — the provider needs the
model listed in the config to call it). Then run the
`openmind-set-custom-endpoint` command (it is installed on the PATH on
every platform: `openmind-set-custom-endpoint` in the guest Terminal,
Linux, and Termux) with all three values:

  openmind-set-custom-endpoint --url <url> --key <key> --model <model-id>

The script saves the URL and key to ~/.config/opencode/.env (mode
0600), records the model in the config, and never prints the key.
Report back exactly what it printed: the saved URL, the recorded
model, that the key was saved, and the file. Then tell the user how to
use it: pick the Custom endpoint provider in the model picker
(model custom/<model-id>), or run
`opencode run --model custom/<model-id> "..."`. On the iOS app it picks
the file up automatically on the next start; on Linux / Termux they
need to run `source ~/.config/opencode/.env` once first (the script
offers to add that line to ~/.bashrc).

Do NOT print the bearer key back, in full or in part. Do NOT write the
key into opencode.json, a chat message, or any other file — the .env
file is the only place it goes. If the user only wants to see what is
saved, run `openmind-set-custom-endpoint --show` (it never shows the
key). To remove it, run `openmind-set-custom-endpoint --clear`.
