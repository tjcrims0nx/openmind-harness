# OMH feature parity assessment — independent implementation

Reference reviewed: https://shadow.redpillreader.com/ (product feature descriptions, not source code).
OMH must not copy Shadow's branding, artwork, interface source, or proprietary implementation. Implement features using OpenCode and original OMH code; preserve all existing upstream license notices.

## Already exposed by OMH / OpenCode

- Plan/build agent modes; tool loop (read/write/edit, grep/glob, shell, web, task/todo).
- Configurable provider registry, including Gemini default and custom endpoints.
- Session persistence and model switching in an existing session.
- Built-in subagents, MCP configuration support, and SKILL.md discovery.
- Project instructions and session history.
- Permission rules; scripts/set-autonomy.sh exposes four presets on desktop/Termux.

These are capabilities/configuration, **not evidence of iOS UI or end-to-end success**.

## Gaps to implement and verify

1. **iOS navigation**: screenshot/interaction tests for sidebar, projects, session creation, plan/build selector, provider picker, terminal, settings, reconnect, and session restoration. Tests must assert actual state changes, not just page HTTP 200.
2. **iOS autonomy UI**: expose manual / auto-read / auto-edit / full as native or web controls backed by OpenCode permissions; show current policy, ask for confirmation on expanded permissions, preserve reviewer read-only.
3. **Hooks**: current docs report local guard plugin is dormant on OpenCode 1.19.6. Do not claim enforcement until an actual denied tool invocation is demonstrated; enforce critical restrictions at a supported boundary.
4. **Background agents**: prove that tasks can continue and be inspected after app suspend/resume; validate worktree isolation and cleanup.
5. **Local model endpoints**: test LAN/private endpoint connection deliberately authorized by the user, without allowing web-fetch tools to bypass SSRF restrictions.
6. **Credential storage**: user-entered provider keys must not be embedded in the IPA, rootfs archive, screenshots, test artifacts, or logs. GitHub Actions secrets are CI-only.
7. **Session durability**: verify export/resume/revert and mid-session provider changes after restart and image migration.
8. **Privacy**: audit all network requests and telemetry claims rather than inferring privacy from product copy.
9. **Security**: verify path containment, credential-file denial, symlink handling, and approvals on actual iOS guest execution.
10. **Compatibility**: macOS/Linux-only sandbox mechanisms cannot be assumed to work under iSH on iOS; test and document the iOS equivalent.

## Release gate

Do not label a capability 'verified on iOS' without a passing simulator or device test, including a recorded control interaction, a successful tool/agent operation where applicable, and no secret exposure. Keep OMH's electric-blue/cyan original visual identity.
