<#
.SYNOPSIS
    Conflux Lens — One-Line Installer for Windows
.DESCRIPTION
    Downloads and installs Conflux Lens — an LLM-aware HTTP proxy for
    inspecting and debugging AI agent API traffic.

    Usage:
        powershell -c "irm https://lens.theconflux.com/install.ps1 | iex"

    What this script does:
        1. Checks prerequisites (Node 18+, npm, git)
        2. Clones the conflux-lens repo
        3. Installs npm dependencies
        4. Builds the project
        5. Generates HTTPS CA certificate for MITM interception
        6. Configures environment variables (session or persistent)
        7. Prints next steps

    Idempotent — safe to re-run. Skips completed steps.
.LINK
    https://github.com/TheConflux-Core/conflux-lens
#>

#requires -Version 5.1

# ─── Configuration ───────────────────────────────────────────────────────────
$REPO_HTTPS = "https://github.com/TheConflux-Core/conflux-lens.git"
$REPO_SSH   = "git@github.com:TheConflux-Core/conflux-lens.git"
$INSTALL_DIR = Join-Path $env:USERPROFILE ".conflux-lens"
$CA_PATH     = Join-Path $env:USERPROFILE ".conflux-lens" "ca.pem"
$MIN_NODE_MAJOR = 18
$SCRIPT_VERSION = "0.3.0"

# ─── Helpers ─────────────────────────────────────────────────────────────────
function Write-Info   { Write-Host "  → $args" -ForegroundColor Cyan }
function Write-Ok     { Write-Host "  ✓ $args" -ForegroundColor Green }
function Write-Warn   { Write-Host "  ⚠ $args" -ForegroundColor Yellow }
function Write-Err    { Write-Host "  ✗ $args" -ForegroundColor Red }
function Write-Header { Write-Host ("═" * 60) -ForegroundColor Blue }
function Write-SubHeader { Write-Host "`n── $args ─" -ForegroundColor Magenta }

function Write-Banner {
    $banner = @"

    ╔══════════════════════════════════════════════════════╗
    ║                                                      ║
    ║   ______            ______               __          ║
    ║  / ____/___  ____  / __/ /_  ___  __    / /   ___   ║
    ║ / /   / __ \/ __ \/ /_/ / / / / |/_/   / /   / _ \  ║
    ║/ /___/ /_/ / / / / __/ / /_/ />  <    / /___/  __/  ║
    ║\____/\____/_/ /_/_/ /_/\__,_/_/|_|   /_____/\___/   ║
    ║                                                      ║
    ║   _      _____ _   _  _____                          ║
    ║  | |    |  ___| \ | |/  ___|                         ║
    ║  | |    | |__ |  \| |\ `--.                          ║
    ║  | |    |  __|| . ` | `--. \                         ║
    ║  | |____| |___| |\  |/\__/ /                         ║
    ║  \_____/\____/\_| \_/\____/                          ║
    ║                                                      ║
    ╚══════════════════════════════════════════════════════╝

"@
    Write-Host $banner -ForegroundColor Cyan
    Write-Host "  LLM-aware HTTP proxy for inspecting AI agent API traffic" -ForegroundColor DarkGray
    Write-Host ""
}

function Confirm-YesNo {
    param([string]$Prompt, [string]$Default = "y")
    $suffix = if ($Default -eq "y") { "[Y/n]" } else { "[y/N]" }
    $response = Read-Host "  ? $Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($response)) { return $Default -eq "y" }
    return $response -match '^(y|yes)$'
}

# ─── Prerequisites ───────────────────────────────────────────────────────────
function Test-Prerequisites {
    Write-SubHeader "🔍 Prerequisites"
    $missing = $false

    # Node.js
    try {
        $nodeVer = (node --version) -replace '^v', ''
        $major = [int]($nodeVer -split '\.')[0]
        if ($major -ge $MIN_NODE_MAJOR) {
            Write-Ok "Node.js $nodeVer"
        } else {
            Write-Warn "Node.js $nodeVer found — version $MIN_NODE_MAJOR+ required"
            $missing = $true
        }
    } catch {
        Write-Err "Node.js not found — install from https://nodejs.org (v$MIN_NODE_MAJOR+)"
        $missing = $true
    }

    # npm
    try {
        $npmVer = npm --version
        Write-Ok "npm $npmVer"
    } catch {
        Write-Err "npm not found (comes with Node.js — reinstall if missing)"
        $missing = $true
    }

    # Git
    try {
        $gitVer = git --version
        Write-Ok "Git $gitVer"
    } catch {
        Write-Warn "Git not found — will use ZIP download instead"
        Write-Warn "Install Git for Windows: https://git-scm.com/download/win"
    }

    if ($missing) {
        Write-Host ""
        Write-Err "Missing dependencies. Install them and re-run."
        Write-Host ""
        Write-Info "Download Node.js (includes npm): https://nodejs.org"
        Write-Info "Download Git for Windows:       https://git-scm.com/download/win"
        exit 1
    }
}

# ─── Clone / Download ────────────────────────────────────────────────────────
function Install-Repository {
    Write-SubHeader "📥 Download"

    if (Test-Path $INSTALL_DIR) {
        Write-Ok "Conflux Lens already cloned at $INSTALL_DIR"
        Push-Location $INSTALL_DIR
        try {
            Write-Info "Updating..."
            git pull --ff-only 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Updated to latest"
            } else {
                Write-Warn "Could not update (local changes may exist)"
            }
        } finally {
            Pop-Location
        }
        return
    }

    # Try git clone
    $cloned = $false
    try {
        Write-Info "Cloning via HTTPS..."
        git clone $REPO_HTTPS $INSTALL_DIR 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Cloned successfully"
            $cloned = $true
        }
    } catch {
        # git not available — fall through to ZIP
    }

    if (-not $cloned) {
        Write-Warn "Git clone failed — downloading ZIP..."
        $zipUrl = "https://github.com/TheConflux-Core/conflux-lens/archive/refs/heads/main.zip"
        $zipPath = Join-Path $env:TEMP "conflux-lens.zip"
        $extractPath = Join-Path $env:TEMP "conflux-lens-extract"

        try {
            Write-Info "Downloading..."
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
            Write-Info "Extracting..."
            Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue
            Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

            # Move contents to install dir
            $extractedDir = Join-Path $extractPath "conflux-lens-main"
            if (Test-Path $extractedDir) {
                Remove-Item -Path $INSTALL_DIR -Recurse -Force -ErrorAction SilentlyContinue
                Move-Item -Path $extractedDir -Destination $INSTALL_DIR -Force
            }
            Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "Downloaded and extracted ZIP"
        } catch {
            Write-Err "Failed to download ZIP: $_"
            exit 1
        }
    }
}

# ─── Install Dependencies ────────────────────────────────────────────────────
function Install-Dependencies {
    Write-SubHeader "📦 Install Dependencies"
    Push-Location $INSTALL_DIR

    try {
        $modulesPath = Join-Path $INSTALL_DIR "node_modules"
        if (Test-Path $modulesPath) {
            Write-Ok "Node modules already installed"
            # Check if lock file is newer
            $lockFile = Join-Path $INSTALL_DIR "package-lock.json"
            if (Test-Path $lockFile) {
                $lockTime = (Get-Item $lockFile).LastWriteTime
                $modulesTime = (Get-Item $modulesPath).LastWriteTime
                if ($lockTime -gt $modulesTime) {
                    Write-Info "Dependencies out of date — updating..."
                    npm install 2>&1 | Select-Object -Last 3
                    Write-Ok "Dependencies updated"
                }
            }
        } else {
            Write-Info "Installing npm dependencies (this may take a moment)..."
            $output = npm install 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Dependencies installed"
                $output | Select-Object -Last 3 | ForEach-Object { if ($_) { Write-Host "     $_" -ForegroundColor DarkGray } }
            } else {
                Write-Err "npm install failed"
                $output | ForEach-Object { if ($_) { Write-Host "     $_" -ForegroundColor Red } }
                exit 1
            }
        }
    } finally {
        Pop-Location
    }
}

# ─── Build ────────────────────────────────────────────────────────────────────
function Build-Project {
    Write-SubHeader "🔨 Build"
    Push-Location $INSTALL_DIR

    try {
        $distIndex = Join-Path $INSTALL_DIR "dist" "index.js"
        if ((Test-Path $distIndex)) {
            Write-Ok "Project already built"
            Write-Info "Refreshing build..."
        } else {
            Write-Info "Building project..."
        }

        $output = npm run build 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Build complete"
            $output | Select-Object -Last 3 | ForEach-Object { if ($_) { Write-Host "     $_" -ForegroundColor DarkGray } }
        } else {
            Write-Err "Build failed"
            $output | ForEach-Object { if ($_) { Write-Host "     $_" -ForegroundColor Red } }
            exit 1
        }
    } finally {
        Pop-Location
    }
}

# ─── HTTPS Certificate ───────────────────────────────────────────────────────
function Setup-HTTPS {
    Write-SubHeader "🔐 HTTPS Interception Setup"
    Push-Location $INSTALL_DIR

    try {
        if (Test-Path $CA_PATH) {
            Write-Ok "HTTPS CA certificate already exists"
            Write-Info "Path: $CA_PATH"
        } else {
            Write-Info "Generating HTTPS CA certificate for MITM interception..."
            $output = npm run setup-trust setup 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "CA certificate generated"
            } else {
                Write-Warn "Could not generate CA cert automatically"
                Write-Info "You can set it up later: cd $INSTALL_DIR && npm run setup-trust setup"
                $output | ForEach-Object { if ($_) { Write-Host "     $_" -ForegroundColor Yellow } }
            }
        }
    } finally {
        Pop-Location
    }
}

# ─── Environment Configuration ───────────────────────────────────────────────
function Configure-Environment {
    Write-SubHeader "⚙️  Environment Configuration"

    if (-not (Test-Path $CA_PATH)) {
        Write-Warn "CA certificate not found — skipping environment config"
        return
    }

    Write-Host ""
    Write-Info "To use Conflux Lens, set these environment variables:"
    Write-Host ""
    Write-Host "    `$env:NODE_EXTRA_CA_CERTS = `"$CA_PATH`"" -ForegroundColor White
    Write-Host "    `$env:HTTP_PROXY          = `"http://localhost:9876`"" -ForegroundColor White
    Write-Host "    `$env:HTTPS_PROXY         = `"http://localhost:9876`"" -ForegroundColor White
    Write-Host ""

    if (Confirm-YesNo "Add these to your PowerShell profile (permanent)?" "y") {
        $profilePath = $PROFILE.CurrentUserAllHosts
        $profileDir = Split-Path $profilePath -Parent

        if (-not (Test-Path $profileDir)) {
            New-Item -Path $profileDir -ItemType Directory -Force | Out-Null
        }

        # Check if already configured
        $content = ""
        if (Test-Path $profilePath) {
            $content = Get-Content $profilePath -Raw
        }
        if ($content -match "NODE_EXTRA_CA_CERTS.*conflux-lens") {
            Write-Ok "Already configured in profile: $profilePath"
        } else {
            $profileLines = @(
                "`n# Conflux Lens — HTTPS CA cert for MITM interception"
                '${env:NODE_EXTRA_CA_CERTS} = "' + $CA_PATH + '"'
                "`n# Conflux Lens — Proxy for AI agent traffic inspection"
                '${env:HTTP_PROXY}  = "http://localhost:9876"'
                '${env:HTTPS_PROXY} = "http://localhost:9876"'
            )
            Add-Content -Path $profilePath -Value $profileLines -NoNewline
            Write-Ok "Added to profile: $profilePath"
            Write-Info "Restart PowerShell or run:  . `$PROFILE"
        }
    } else {
        Write-Info "For current session only, run these in your terminal:"
        Write-Host ""
        Write-Host "    `$env:NODE_EXTRA_CA_CERTS = `"$CA_PATH`"" -ForegroundColor White
        Write-Host "    `$env:HTTP_PROXY          = `"http://localhost:9876`"" -ForegroundColor White
        Write-Host "    `$env:HTTPS_PROXY         = `"http://localhost:9876`"" -ForegroundColor White
        Write-Host ""
    }
}

# ─── Next Steps ──────────────────────────────────────────────────────────────
function Show-NextSteps {
    Write-SubHeader "🎯 Next Steps"
    Write-Host @"

  1. Start the proxy:
     cd $INSTALL_DIR
     npm start

  2. Open the dashboard:
     http://localhost:3000

  3. Configure your AI agent to use the proxy:
     `$env:HTTP_PROXY          = "http://localhost:9876"
     `$env:HTTPS_PROXY         = "http://localhost:9876"
     `$env:NODE_EXTRA_CA_CERTS = "$CA_PATH"

  4. For browser testing, trust the CA cert:
     Import $CA_PATH into your browser's
     certificate authorities (Chrome: chrome://settings/certificates)
     See README for Firefox, Edge, and system-wide setup.

  5. Install the SDK in your project:
     npm install @conflux/sdk ws

"@ -ForegroundColor Gray
}

# ─── Main ────────────────────────────────────────────────────────────────────
function Main {
    Clear-Host

    # ── Banner ──
    Write-Banner
    Write-Host "  ℹ  Conflux Lens v$SCRIPT_VERSION — One-Line Installer" -ForegroundColor White
    Write-Host "     https://github.com/TheConflux-Core/conflux-lens" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  About: LLM-aware HTTP proxy for inspecting AI agent API traffic." -ForegroundColor Yellow
    Write-Host "         Monitor requests, responses, tokens, costs, tool calls & streams." -ForegroundColor Yellow

    # ── Stage 1: Prerequisites ──
    Test-Prerequisites

    # ── Stage 2: Clone ──
    Install-Repository

    # ── Stage 3: Install Dependencies ──
    Install-Dependencies

    # ── Stage 4: Build ──
    Build-Project

    # ── Stage 5: HTTPS CA ──
    Setup-HTTPS

    # ── Stage 6: Environment Config ──
    Configure-Environment

    # ── Complete ──
    Write-Header
    Write-Host "  ✅ Conflux Lens installed successfully!" -ForegroundColor Green
    Write-Header

    Show-NextSteps

    # Final check
    $distIndex = Join-Path $INSTALL_DIR "dist" "index.js"
    if (Test-Path $distIndex) {
        Write-Ok "Ready to launch! Run:  cd $INSTALL_DIR && npm start"
    } else {
        Write-Warn "Build output not found — try:  cd $INSTALL_DIR && npm run build && npm start"
    }
    Write-Host ""
}

# ─── Execute ─────────────────────────────────────────────────────────────────
Main
