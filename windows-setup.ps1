# OpenMind Harness — Windows setup (PowerShell). Installs the SAME harness as
# the iOS app and the Linux/macOS setups: OpenCode 1.19.6 + the universal
# multi-provider config from opencode.json.
#
# Run in PowerShell (as a normal user — no admin rights needed) from a clone
# of the repo:
#   git clone https://github.com/tjcrims0nx/openmind-harness.git
#   cd openmind-harness
#   .\windows-setup.ps1 [-NoLaunch]
#
# Or download just this file first, then run it from the folder it landed in:
#   # (save windows-setup.ps1 from the repo, then in that folder:)
#   .\windows-setup.ps1 [-NoLaunch]
#
# If PowerShell blocks the script because it came from the internet, unblock
# that one file first (no policy change):
#   Unblock-File .\windows-setup.ps1
#
# Install method: the official Windows binary zip first (deterministic —
# the same release the iOS guest, Linux and macOS use, x64 or ARM64).
# Node.js 22+ is only needed for the OMH runtime/MCP bridge step; the
# OpenCode binary itself does not need Node.
#
# What it does:
#   1. Installs OpenCode 1.19.6 to %LOCALAPPDATA%\Programs\opencode
#      (or reuses it if present) and adds it to your user PATH.
#   2. Installs the universal config to %USERPROFILE%\.config\opencode\opencode.json,
#      the starter skill to %USERPROFILE%\.config\opencode\skills\, and the
#      guard plugin to %USERPROFILE%\.config\opencode\plugins\ (from a repo
#      clone; config is downloaded when run standalone).
#   3. Launches `opencode web` in the foreground (unless -NoLaunch):
#      the web UI on http://127.0.0.1:4097.
#
# Keys are NEVER stored by this script. Set them in your shell first
# (or add them in the web UI's model picker with /connect), e.g.:
#   $env:OPENAI_API_KEY = 'sk-...'
#   $env:EXPLABS_API_KEY = '...'
# With no keys set, the UI still starts — it prompts for a key when a model
# is first used. The free fallback (Experiential Labs deepseek-v4.1-flash:free)
# needs only EXPLABS_API_KEY.
#
# Remote access: by default the UI binds 127.0.0.1 (this machine only).
# To reach it from another device, set a password and bind all interfaces:
#   $env:OPENCODE_SERVER_PASSWORD = 'a-long-random-password'
#   opencode web --hostname 0.0.0.0
# (Do not expose it without a password — the server has no login otherwise.)
#
# Windows notes:
#   - No admin rights needed; everything installs under your user profile.
#   - The delete-env and custom-endpoint helpers are bash scripts; they are
#     installed for Git Bash users and do not run in plain PowerShell/cmd.
#   - The OMH runtime/MCP bridge needs Node.js 22+. If Node is missing or
#     too old, this script tries winget, then the official Node.js zip.
[CmdletBinding()]
param(
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$OpenCodeVersion = if ($env:OPENCODE_VERSION) { $env:OPENCODE_VERSION } else { '1.19.6' }
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '22.21.0' }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRaw = 'https://raw.githubusercontent.com/tjcrims0nx/openmind-harness/main'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\opencode'
$NodeRoot = Join-Path $env:LOCALAPPDATA 'Programs\node'
$ConfigHome = Join-Path $env:USERPROFILE '.config\opencode'

function Write-Step($msg) { Write-Host $msg }

function Get-NodeMajorVersion {
    try {
        $v = & node --version 2>$null
        if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
}

function Refresh-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Add-UserPathOnce($dir) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = $userPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' }
    $found = $false
    foreach ($p in $parts) { if ($p.TrimEnd('\') -ieq $dir.TrimEnd('\')) { $found = $true } }
    if (-not $found) {
        $newPath = if ($userPath) { "$userPath;$dir" } else { $dir }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Step "added $dir to your user PATH (new shells will see it)"
    }
    if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$env:Path;$dir" }
}

# --- helper: ensure Node.js 22+ is available (for the OMH runtime step) ---
# Returns the node exe path, or $null.
function Ensure-Node {
    $major = Get-NodeMajorVersion
    if ($major -ge 22) { return (Get-Command node).Source }
    if ($major -gt 0) {
        Write-Step "Node.js $(& node --version) is too old for the OMH runtime (needs 22+) — trying to install 22..."
    } else {
        Write-Step "Node.js not found — trying to install Node.js $NodeVersion for the OMH runtime..."
    }
    # winget first (built into Windows 10/11).
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
            Refresh-PathFromRegistry
            if ((Get-NodeMajorVersion) -ge 22) {
                Write-Step "installed Node.js via winget: $(& node --version)"
                return (Get-Command node).Source
            }
        } catch {
            Write-Step "winget Node install failed — trying the official Node.js zip..."
        }
    }
    # Official Node.js Windows zip, installed under %LOCALAPPDATA%\Programs\node.
    $arch = $env:PROCESSOR_ARCHITECTURE
    $nodeArch = switch ($arch) { 'ARM64' { 'arm64' } default { 'x64' } }
    $zipName = "node-v$NodeVersion-win-$nodeArch.zip"
    $tmp = Join-Path $env:TEMP ([Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
        $zipPath = Join-Path $tmp $zipName
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$zipName" -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
        $extracted = Join-Path $tmp "node-v$NodeVersion-win-$nodeArch"
        if (Test-Path (Join-Path $extracted 'node.exe')) {
            if (Test-Path $NodeRoot) { Remove-Item -Recurse -Force $NodeRoot }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $NodeRoot) | Out-Null
            Move-Item -Path $extracted -Destination $NodeRoot
            $nodeExe = Join-Path $NodeRoot 'node.exe'
            if (($env:Path -split ';') -notcontains $NodeRoot) { $env:Path = "$NodeRoot;$env:Path" }
            Write-Step "installed Node.js: $(& $nodeExe --version) ($NodeRoot)"
            return $nodeExe
        }
    } catch {
        Write-Step "Node.js zip install failed: $($_.Exception.Message)"
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
    Write-Step 'WARNING: could not install Node.js 22+ — the OMH runtime/MCP bridge step will be skipped.'
    return $null
}

# --- config source: repo clone if present, else download from GitHub ---
$ConfigSrc = Join-Path $ScriptDir 'opencode.json'
$SkillsSrc = Join-Path $ScriptDir 'skills'
$PluginsSrc = Join-Path $ScriptDir 'plugins'
$DeleteEnvSrc = Join-Path $ScriptDir 'scripts\delete-env.sh'
$CommandSrc = Join-Path $ScriptDir 'commands\delete-env.md'
$SetCustomEndpointSrc = Join-Path $ScriptDir 'scripts\set-custom-endpoint.sh'
$CustomEndpointCommandSrc = Join-Path $ScriptDir 'commands\custom-endpoint.md'
$AntigravityBridgeSrc = Join-Path $ScriptDir 'scripts\antigravity-bridge.mjs'
$AntigravityLoginSrc = Join-Path $ScriptDir 'scripts\antigravity-login.mjs'
$RuntimeInstallerSrc = Join-Path $ScriptDir 'scripts\install-omh-runtime.mjs'
$IsClone = Test-Path $ConfigSrc
if (-not $IsClone) {
    $ConfigSrc = Join-Path $env:TEMP 'opencode-omhd.json'
    Write-Step 'Downloading the universal config...'
    Invoke-WebRequest -Uri "$RepoRaw/opencode.json" -OutFile $ConfigSrc -UseBasicParsing
}

# --- 1. OpenCode (binary zip) ---
$OpenCodeExe = Join-Path $InstallRoot 'opencode.exe'
if (Get-Command opencode -ErrorAction SilentlyContinue) {
    Write-Step "opencode already installed: $(& opencode --version)"
} else {
    $arch = $env:PROCESSOR_ARCHITECTURE
    $binArch = switch ($arch) { 'ARM64' { 'arm64' } default { 'x64' } }
    $zipName = "opencode-windows-$binArch.zip"
    Write-Step "Installing OpenCode $OpenCodeVersion ($zipName)..."
    $tmp = Join-Path $env:TEMP ([Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
        $zipPath = Join-Path $tmp $zipName
        Invoke-WebRequest -Uri "https://github.com/sst/opencode/releases/download/v$OpenCodeVersion/$zipName" -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
        $extractedExe = Join-Path $tmp 'opencode.exe'
        if (-not (Test-Path $extractedExe)) { throw "opencode.exe not found in $zipName" }
        New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
        Copy-Item -Path $extractedExe -Destination $OpenCodeExe -Force
        Add-UserPathOnce $InstallRoot
        Write-Step "installed: $OpenCodeExe ($(& $OpenCodeExe --version))"
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}
if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    if (Test-Path $OpenCodeExe) {
        if (($env:Path -split ';') -notcontains $InstallRoot) { $env:Path = "$env:Path;$InstallRoot" }
    } else {
        Write-Error 'ERROR: opencode install failed.'
        exit 1
    }
}

# --- 2. Universal config + starter skill + guard plugin (same files the iOS app ships) ---
New-Item -ItemType Directory -Force -Path $ConfigHome | Out-Null
Copy-Item -Path $ConfigSrc -Destination (Join-Path $ConfigHome 'opencode.json') -Force
Write-Step "config installed: $ConfigHome\opencode.json (default model google/gemini-3.5-flash-lite)"
if ($IsClone -and (Test-Path $RuntimeInstallerSrc)) {
    $nodeExe = Ensure-Node
    if ($nodeExe) {
        & $nodeExe $RuntimeInstallerSrc
        Write-Step 'OMH runtime and MCP tools installed'
    } else {
        Write-Step 'OMH runtime skipped: Node.js 22+ is required (install it, then run: node scripts\install-omh-runtime.mjs)'
    }
} else {
    Write-Step 'OMH runtime skipped: requires a repo checkout (scripts\install-omh-runtime.mjs not found)'
}
if ($IsClone -and (Test-Path $SkillsSrc)) {
    $dest = Join-Path $ConfigHome 'skills'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $SkillsSrc '*') -Destination $dest -Recurse -Force
    Write-Step "skills installed: $dest (openmind-harness)"
} else {
    Write-Step 'skills skipped (run from a repo clone to install them: skills\ -> %USERPROFILE%\.config\opencode\skills\)'
}
if ($IsClone -and (Test-Path $PluginsSrc)) {
    $dest = Join-Path $ConfigHome 'plugins'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $PluginsSrc '*') -Destination $dest -Recurse -Force
    Write-Step "plugins installed: $dest (openmind-guard)"
} else {
    Write-Step 'plugins skipped (run from a repo clone to install them: plugins\ -> %USERPROFILE%\.config\opencode\plugins\)'
}
if ($IsClone -and (Test-Path $DeleteEnvSrc)) {
    Copy-Item -Path $DeleteEnvSrc -Destination (Join-Path $InstallRoot 'openmind-delete-env') -Force
    Write-Step 'delete-env installed (Git Bash): openmind-delete-env — run it from Git Bash, not PowerShell'
} else {
    Write-Step 'delete-env skipped (run from a repo clone to install it)'
}
if ($IsClone -and (Test-Path $SetCustomEndpointSrc)) {
    Copy-Item -Path $SetCustomEndpointSrc -Destination (Join-Path $InstallRoot 'openmind-set-custom-endpoint') -Force
    Write-Step 'custom-endpoint installed (Git Bash): openmind-set-custom-endpoint (your own API URL + bearer key)'
} else {
    Write-Step 'custom-endpoint skipped (run from a repo clone to install it)'
}
if ($IsClone -and (Test-Path $AntigravityBridgeSrc) -and (Test-Path $AntigravityLoginSrc)) {
    Copy-Item -Path $AntigravityBridgeSrc -Destination (Join-Path $InstallRoot 'openmind-antigravity-bridge.mjs') -Force
    Copy-Item -Path $AntigravityLoginSrc -Destination (Join-Path $InstallRoot 'openmind-antigravity-login.mjs') -Force
    Write-Step 'antigravity installed: openmind-antigravity-login.mjs (sign in with your Google account)'
    Write-Step "  then start the bridge: node $InstallRoot\openmind-antigravity-bridge.mjs"
    Write-Step '  (the antigravity provider in the config points at it on 127.0.0.1:18080)'
} else {
    Write-Step 'antigravity skipped (run from a repo clone to install it: scripts\antigravity-*.mjs)'
}
if ($IsClone -and (Test-Path $CommandSrc)) {
    $dest = Join-Path $ConfigHome 'command'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path $CommandSrc -Destination (Join-Path $dest 'delete-env.md') -Force
    Write-Step "command installed: $dest\delete-env.md (/delete-env in the web UI)"
} else {
    Write-Step 'command skipped (run from a repo clone to install it: commands\delete-env.md)'
}
if ($IsClone -and (Test-Path $CustomEndpointCommandSrc)) {
    $dest = Join-Path $ConfigHome 'command'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path $CustomEndpointCommandSrc -Destination (Join-Path $dest 'custom-endpoint.md') -Force
    Write-Step "command installed: $dest\custom-endpoint.md (/custom-endpoint in the web UI)"
} else {
    Write-Step 'command skipped (run from a repo clone to install it: commands\custom-endpoint.md)'
}

# --- 3. Launch (unless asked not to) ---
if ($NoLaunch) {
    Write-Host ''
    Write-Host 'Ready. Launch the web UI with:'
    Write-Host '  opencode web        # http://127.0.0.1:4097'
    Write-Host 'Or the API server with:  opencode serve   # http://127.0.0.1:4096'
    exit 0
}
Write-Host ''
Write-Host 'Starting the web UI — open http://127.0.0.1:4097 (Ctrl-C to stop).'
Write-Host 'Model picker (top of the UI) switches providers; default is google/gemini-3.5-flash-lite,'
Write-Host 'free fallback is experientiallabs/deepseek-v4.1-flash:free.'
Write-Host 'ChatGPT Plus? Sign in once first: opencode auth login --provider openai'
Write-Host '— GPT-5 then uses your subscription, no API credits needed.'
Write-Host 'Agents: build (default), fast (free fallback), reviewer (read-only subagent).'
& opencode web
