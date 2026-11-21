---
name: OpenMind Harness
description: Use the OpenMind Harness — OpenCode with the universal multi-provider config. Use when choosing a provider/model, switching models, or when the default model has no credits and the free fallback is needed.
---

# OpenMind Harness

This workspace runs OpenCode with the universal multi-provider config
(`cross-platform/opencode.json` in the repo, `~/.config/opencode/opencode.json`
on the machine). Same harness on iOS, Linux, and Termux — only the shell differs.

## Providers (switch in the model picker or with the model flag)

| Provider | Model | Key | Notes |
|---|---|---|---|
| OpenAI (default) | `openai/gpt-5` | ChatGPT Plus/Pro OAuth (`opencode auth login --provider openai`) or `OPENAI_API_KEY` | ChatGPT models. With a Plus/Pro subscription, sign in via OAuth — requests count against the subscription, not API billing, and no API credits are needed. API-key use needs credits — no credits returns `credit_balance_exhausted`. |
| Experiential Labs (free fallback) | `experientiallabs/deepseek-v4.1-flash:free` | `EXPLABS_API_KEY` | Free stock route. Use this when OpenAI has no credits. |
| DeepSeek | `deepseek/deepseek-flash`, `deepseek/deepseek-v4-pro` | `DEEPSEEK_API_KEY` | Stock DeepSeek API models. |
| Gemini | `google/gemini-2.5-flash`, `google/gemini-3.5-flash-lite`, … | `GEMINI_API_KEY` | Google provider. |
| OrcaRouter | `orcarouter/z-ai/glm-5.3-flash-free` (verified live), `orcarouter/tencent/hy3-free`, `orcarouter/tencent/hy4-preview-free` | `ORCAROUTER_API_KEY` | Free models on the gateway. |
| OpenRouter | `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, … | `OPENROUTER_API_KEY` | OpenRouter's free models. |

## ChatGPT Plus

The default model is GPT-5 and it works on a ChatGPT Plus/Pro subscription
— no API credits needed. Sign in once:

```sh
opencode auth login --provider openai
```

- Browser flow (`ChatGPT Pro/Plus (browser)`) — Linux and Termux.
- Device code (`ChatGPT Pro/Plus (headless)`) — iPad guest (in the app's
  Terminal), SSH, containers; enter the code at
  `auth.openai.com/codex/device`.
- Login state lives in `~/.local/share/opencode/auth.json`; copy that one
  file between platforms to move a login. Never paste its contents.

## Task-routed agents (same config)

- `build` (default) — the standard coding agent, default model `openai/gpt-5`.
- `fast` — small jobs on the free fallback (`experientiallabs/deepseek-v4.1-flash:free`).
  Use it for quick questions, small edits, and summaries.
- `reviewer` — read-only review subagent (`openai/gpt-5`, no edit/shell).
  Ask the primary agent to use it: "Use the reviewer subagent to review my current changes."

## Rules

- Never put an API key in a file, a command, or a message. Keys come from
  environment variables, the web UI's `/connect` flow, or `opencode auth login`
  (ChatGPT Plus/Pro OAuth) only.
- If the default model fails with `credit_balance_exhausted`, switch to the
  free fallback (`experientiallabs/deepseek-v4.1-flash:free`) and say so —
  do not retry the paid model.
- Work in sessions: keep one session per unit of work so it stays resumable.
- The agent loop is standard: prompt → model → tools → execute → observe →
  repeat. No custom agent behavior is defined here.
