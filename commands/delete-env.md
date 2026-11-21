---
description: Delete saved env — remove stored credentials, sessions, caches and logs to free up space
agent: general
---

Delete the saved environment on this machine to free up space.

Run the `openmind-delete-env` command (it is installed on the PATH on
every platform: `openmind-delete-env` in the guest Terminal, Linux, and
Termux). Ask the user first whether to keep sessions; if they say keep
them, pass `--keep-sessions`, otherwise run it with `--yes` so it does
not prompt again:

  openmind-delete-env --yes

If the user wants key exports stripped from their shell rc files too,
add `--purge-rc`.

After it finishes, report back exactly what it printed: what was
removed, how much space was freed, and which providers' credentials were
removed. Then remind the user that the harness itself is untouched and
starts cleanly — they just need to sign in again (ChatGPT Plus:
`opencode auth login --provider openai`) or re-enter provider keys.

Do NOT delete anything by hand. Do NOT touch opencode.json, the skills,
the plugins, the workspace, or the guest image. If the script refuses
because a server is running, tell the user to stop the server first
instead of forcing it.
