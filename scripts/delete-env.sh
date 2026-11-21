#!/usr/bin/env bash
# openmind-delete-env — delete saved environment from this machine.
#
# Removes the credentials and runtime state OpenMind Harness / OpenCode
# stores on this device, so nothing stale sits here taking up memory:
#   - stored credentials: ~/.local/share/opencode/auth.json
#     (ChatGPT Plus OAuth tokens and any API keys saved through the UI)
#   - sessions: ~/.local/share/opencode/opencode.db*  (unless --keep-sessions)
#   - logs: ~/.local/share/opencode/log/ and the guard audit log
#   - stale server locks: ~/.local/state/opencode/locks/
#   - caches: ~/.cache/opencode/ (model catalog cache, helper binaries)
#   - ~/.config/opencode/.env if one exists
#   - shell-rc key exports (reported; removed only with --purge-rc)
#
# What it NEVER touches (so the install keeps working):
#   - ~/.config/opencode/opencode.json (the provider config — no keys in it)
#   - skills, plugins, custom commands
#   - the workspace / your files, the opencode binary, the guest image
# After it runs, the harness is exactly as if freshly installed: it starts
# cleanly and just asks you to sign in / enter keys again.
#
# Usage:
#   openmind-delete-env [--yes] [--keep-sessions] [--purge-rc] [--force] [--home DIR]
#     --yes            skip the confirmation prompt
#     --keep-sessions  keep the session database (delete credentials only)
#     --purge-rc       also strip provider-key export lines from shell rc
#                      files (~/.bashrc, ~/.profile, ~/.zshrc); a .bak copy
#                      is kept. Without it, rc hits are only reported.
#     --force          run even while a server is running (not recommended)
#     --home DIR       use DIR as $HOME (default: $HOME; the guest uses /root)
set -u

HOME_DIR="${HOME:-/root}"
YES=0; KEEP_SESSIONS=0; PURGE_RC=0; FORCE=0

while [ $# -gt 0 ]; do
    case "$1" in
        --yes) YES=1; shift ;;
        --keep-sessions) KEEP_SESSIONS=1; shift ;;
        --purge-rc) PURGE_RC=1; shift ;;
        --force) FORCE=1; shift ;;
        --home) HOME_DIR="$2"; shift 2 ;;
        --home=*) HOME_DIR="${1#--home=}"; shift ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

SHARE="$HOME_DIR/.local/share/opencode"
STATE="$HOME_DIR/.local/state/opencode"
CACHE="$HOME_DIR/.cache/opencode"
CONFIG="$HOME_DIR/.config/opencode"

# --- refuse while a server is running (it would rewrite state as we delete) ---
RUNNING=0
if [ -d "$STATE/locks" ]; then
    # A lock is live only if its owner process is still alive (meta.json
    # records the server PID). A dead owner means a stale lock from a
    # stopped or crashed server — even if the heartbeat is seconds old,
    # which is the normal stop-then-wipe-immediately case. With no PID
    # recorded, fall back to a fresh heartbeat (2 min) as the signal.
    for lockdir in "$STATE/locks"/*.lock; do
        [ -d "$lockdir" ] || continue
        pid=$(sed -n 's/.*"pid":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$lockdir/meta.json" 2>/dev/null | head -1)
        if [ -n "$pid" ]; then
            kill -0 "$pid" 2>/dev/null && RUNNING=1
        elif [ -f "$lockdir/heartbeat" ] && find "$lockdir" -name heartbeat -mmin -2 -print -quit 2>/dev/null | grep -q .; then
            RUNNING=1
        fi
    done
fi
if command -v pgrep >/dev/null 2>&1; then
    # Match by executable name, then check the command line for the serve
    # subcommand. (Plain `pgrep -f "opencode serve"` is not used: it also
    # matches the shell running this script, whose command line contains
    # the same words.)
    for pid in $(pgrep -x opencode 2>/dev/null); do
        [ "$pid" = "$$" ] || [ "$pid" = "$PPID" ] || {
            if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q " serve"; then
                RUNNING=1
            fi
        }
    done
fi
if [ "$RUNNING" = 1 ] && [ "$FORCE" = 0 ]; then
    echo "A harness server looks running (lock or 'opencode serve' process)." >&2
    echo "Stop it first (control bar Stop, or Ctrl-C in the terminal), then run this again." >&2
    echo "Or pass --force to delete anyway (not recommended)." >&2
    exit 2
fi

# --- human-readable size of a path (KB via du -sk, works on GNU + busybox) ---
human() {
    local kb="$1"
    if [ "$kb" -ge 1048576 ]; then
        awk -v k="$kb" 'BEGIN { printf "%.1f GB", k/1048576 }'
    elif [ "$kb" -ge 1024 ]; then
        awk -v k="$kb" 'BEGIN { printf "%.1f MB", k/1024 }'
    else
        echo "${kb} KB"
    fi
}
path_kb() {
    [ -e "$1" ] || { echo 0; return; }
    du -sk "$1" 2>/dev/null | awk '{print $1}'
}

TOTAL_KB=0
removed() { # path label
    local kb; kb=$(path_kb "$1")
    TOTAL_KB=$((TOTAL_KB + kb))
    printf "  removed %-58s %s\n" "$2" "$(human "$kb")"
}

# --- what would be deleted (report first, then confirm) ---
AUTH="$SHARE/auth.json"
PROVIDERS=""
if [ -f "$AUTH" ]; then
    # Provider names only — never print a key or token value.
    PROVIDERS=$(grep -oE '"(openai|deepseek|google|anthropic|groq|mistral|xai|together|ollama|lmstudio|experientiallabs|orcarouter|openrouter|custom)"[[:space:]]*:' "$AUTH" \
        | tr -d '": ' | sort -u | tr '\n' ' ')
fi

echo "OpenMind Harness — delete saved env"
echo "Home: $HOME_DIR"
echo "This will remove:"
[ -f "$AUTH" ] && echo "  credentials: $AUTH${PROVIDERS:+ (providers: $PROVIDERS)}" || echo "  credentials: none stored"
[ "$KEEP_SESSIONS" = 0 ] && { [ -e "$SHARE/opencode.db" ] && echo "  sessions: $SHARE/opencode.db*"; }
[ -d "$SHARE/log" ] && echo "  logs: $SHARE/log/"
[ -f "$SHARE/openmind-guard.log" ] && echo "  guard log: $SHARE/openmind-guard.log"
[ -d "$STATE/locks" ] && echo "  locks: $STATE/locks/"
[ -d "$CACHE" ] && echo "  cache: $CACHE/"
[ -f "$CONFIG/.env" ] && echo "  env file: $CONFIG/.env"

# Shell rc files: report key exports (never edit without --purge-rc).
RC_HITS=""
for rc in "$HOME_DIR/.bashrc" "$HOME_DIR/.profile" "$HOME_DIR/.zshrc" "$HOME_DIR/.bash_profile"; do
    [ -f "$rc" ] || continue
    n=$(grep -cE 'export[[:space:]]+(OPENAI_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY|XAI_API_KEY|TOGETHER_API_KEY|ORCAROUTER_API_KEY|OPENROUTER_API_KEY|EXPLABS_API_KEY|OPENMIND_CUSTOM_API_KEY)=' "$rc" 2>/dev/null || true)
    [ "${n:-0}" -gt 0 ] && RC_HITS="$RC_HITS$rc ($n lines)  "
done
if [ -n "$RC_HITS" ]; then
    if [ "$PURGE_RC" = 1 ]; then
        echo "  shell rc key exports: $RC_HITS[will be stripped]"
    else
        echo "  shell rc key exports: $RC_HITS[reported only]"
    fi
else
    echo "  shell rc key exports: none found"
fi
echo "It will NOT remove: opencode.json, skills, plugins, commands, workspace, binary, guest image."

if [ "$YES" = 0 ]; then
    printf "Delete the above? [y/N] "
    read -r answer
    case "$answer" in
        y|Y|yes|YES) ;;
        *) echo "Cancelled — nothing was deleted."; exit 0 ;;
    esac
fi

echo "Deleting…"
[ -f "$AUTH" ] && { removed "$AUTH" "credentials ($AUTH)"; rm -f "$AUTH"; }
if [ "$KEEP_SESSIONS" = 0 ]; then
    for f in "$SHARE/opencode.db" "$SHARE/opencode.db-wal" "$SHARE/opencode.db-shm"; do
        [ -e "$f" ] && { removed "$f" "sessions ($f)"; rm -f "$f"; }
    done
fi
[ -d "$SHARE/log" ] && { removed "$SHARE/log" "logs ($SHARE/log)"; rm -rf "$SHARE/log"; }
[ -f "$SHARE/openmind-guard.log" ] && { removed "$SHARE/openmind-guard.log" "guard log"; rm -f "$SHARE/openmind-guard.log"; }
[ -d "$STATE/locks" ] && { removed "$STATE/locks" "locks ($STATE/locks)"; rm -rf "$STATE/locks"; }
[ -d "$CACHE" ] && { removed "$CACHE" "cache ($CACHE)"; rm -rf "$CACHE"; }
[ -f "$CONFIG/.env" ] && { removed "$CONFIG/.env" "env file"; rm -f "$CONFIG/.env"; }

if [ "$PURGE_RC" = 1 ] && [ -n "$RC_HITS" ]; then
    for rc in "$HOME_DIR/.bashrc" "$HOME_DIR/.profile" "$HOME_DIR/.zshrc" "$HOME_DIR/.bash_profile"; do
        [ -f "$rc" ] || continue
        grep -qE 'export[[:space:]]+(OPENAI_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY|XAI_API_KEY|TOGETHER_API_KEY|ORCAROUTER_API_KEY|OPENROUTER_API_KEY|EXPLABS_API_KEY|OPENMIND_CUSTOM_API_KEY)=' "$rc" 2>/dev/null || continue
        cp "$rc" "$rc.bak"
        sed -i -E '/export[[:space:]]+(OPENAI_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY|XAI_API_KEY|TOGETHER_API_KEY|ORCAROUTER_API_KEY|OPENROUTER_API_KEY|EXPLABS_API_KEY|OPENMIND_CUSTOM_API_KEY)=/d' "$rc"
        echo "  stripped key exports from $rc (backup: $rc.bak)"
    done
elif [ -n "$RC_HITS" ]; then
    echo "  shell rc key exports left in place (re-run with --purge-rc to strip them)."
fi

echo "Done. Freed about $(human "$TOTAL_KB") in total."
[ -n "$PROVIDERS" ] && echo "Credentials removed for: $PROVIDERS"
echo "Next: sign in again (ChatGPT Plus: opencode auth login --provider openai)"
echo "or re-enter your provider keys — the harness itself is untouched and starts cleanly."
