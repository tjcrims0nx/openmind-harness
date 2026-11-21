---
description: Show how to configure a custom OpenAI-compatible endpoint
agent: general
---

Direct the user to the terminal on their device. Tell them to run
`openmind-set-custom-endpoint` and enter their API base URL, bearer key at the
hidden prompt, and model ID. Keep credentials out of the conversation. If the
user pasted a bearer key into chat, tell them to revoke it and create a new one.

On iOS, restart the app. On Linux or Termux, run
`. ~/.config/opencode/.env` before starting OpenCode from the same shell.
Then select `custom/<model-id>` in the model picker.

For status or removal, show the user the terminal commands
`openmind-set-custom-endpoint --show` and
`openmind-set-custom-endpoint --clear`.
