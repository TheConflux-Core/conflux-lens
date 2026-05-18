#!/usr/bin/env bash
# =============================================================================
#  📦 Conflux Lens — One-Line Installer
#
#  Usage:
#    curl -fsSL https://openclaw.ai/install.sh | bash
#
#  What it does:
#    1. Checks prerequisites (Node 18+, npm, git)
#    2. Clones the conflux-lens repo (if not present)
#    3. Installs npm dependencies
#    4. Builds the project
#    5. Generates HTTPS CA certificate for MITM interception
#    6. Configures NODE_EXTRA_CA_CERTS (session or persistent)
#    7. Prints next steps
#
#  Idempotent — safe to re-run. Skips completed steps.
# =============================================================================

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'  # No Color

# ─── Helpers ─────────────────────────────────────────────────────────────────
info()  { printf "${CYAN}  →${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}  ⚠${NC} %s\n" "$*"; }
err()   { printf "${RED}  ✗${NC} %s\n" "$*"; }
header(){ printf "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"; }
sub_header(){ printf "\n${MAGENTA}── ${BOLD}%s${NC}${MAGENTA} ──────────────────────────────────────────────────────${NC}\n" "$*"; }
prompt_yn() {
    local prompt="$1"
    local default="${2:-y}"
    local yn
    if [ "$default" = "y" ]; then
        prompt="$prompt [Y/n] "
    else
        prompt="$prompt [y/N] "
    fi
    read -r -p "$(printf "${YELLOW}  ?${NC} ${prompt}")" yn
    case "$yn" in
        [Yy]|[Yy][Ee][Ss]) return 0 ;;
        [Nn]|[Nn][Oo])     return 1 ;;
        "")                [ "$default" = "y" ] && return 0 || return 1 ;;
        *)                 return 1 ;;
    esac
}

# ─── Banner ──────────────────────────────────────────────────────────────────
show_banner() {
    cat << 'EOF'

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

    ${DIM}LLM-aware HTTP proxy for inspecting AI agent API traffic${NC}

EOF
}

# ─── Pre-check: Not run as root unless we have to ────────────────────────────
check_not_root() {
    if [ "$(id -u)" -eq 0 ]; then
        warn "Running as root is not recommended."
        warn "Conflux Lens runs as a regular user — no root needed."
        if ! prompt_yn "Continue anyway?" "n"; then
            echo ""
            info "Run without sudo:  curl -fsSL https://openclaw.ai/install.sh | bash"
            exit 1
        fi
    fi
}

# ─── Prerequisites ───────────────────────────────────────────────────────────
check_prereqs() {
    local missing=0

    # Node.js
    if command -v node &>/dev/null; then
        local node_ver
        node_ver=$(node --version | sed 's/^v//' | cut -d. -f1)
        if [ "$node_ver" -ge 18 ] 2>/dev/null; then
            ok "Node.js $(node --version | sed 's/^v//')"
        else
            warn "Node.js $(node --version | sed 's/^v//') found — version 18+ required"
            missing=1
        fi
    else
        err "Node.js not found — install from https://nodejs.org (v18+)"
        missing=1
    fi

    # npm (comes with Node.js, but check anyway)
    if command -v npm &>/dev/null; then
        ok "npm $(npm --version)"
    else
        err "npm not found"
        missing=1
    fi

    # Git
    if command -v git &>/dev/null; then
        ok "Git $(git --version | sed 's/^git version //')"
    else
        warn "Git not found — will use ZIP download instead"
    fi

    if [ "$missing" -eq 1 ]; then
        echo ""
        err "${RED}${BOLD}Missing dependencies. Install them and re-run.${NC}"
        echo ""
        info "macOS:  brew install node git"
        info "Ubuntu: sudo apt install nodejs npm git"
        info "Or download from https://nodejs.org"
        exit 1
    fi
}

# ─── Clone / Update ──────────────────────────────────────────────────────────
clone_repo() {
    local repo_dir="$HOME/.conflux-lens"
    local repo_url="git@github.com:TheConflux-Core/conflux-lens.git"
    local repo_https="https://github.com/TheConflux-Core/conflux-lens.git"

    if [ -d "$repo_dir" ]; then
        ok "Conflux Lens already cloned at ${repo_dir}"
        info "Updating..."
        cd "$repo_dir"
        git pull --ff-only 2>/dev/null && ok "Updated to latest" || warn "Could not update (local changes may exist)"
    else
        info "Cloning Conflux Lens..."
        if command -v git &>/dev/null; then
            # Try SSH first (faster for return users), fall back to HTTPS
            if git clone "$repo_url" "$repo_dir" 2>/dev/null; then
                ok "Cloned via SSH"
            else
                info "SSH not configured, trying HTTPS..."
                git clone "$repo_https" "$repo_dir" || {
                    err "Failed to clone repository"
                    exit 1
                }
                ok "Cloned via HTTPS"
            fi
        else
            # No git — use curl to download ZIP
            warn "Git not available — downloading ZIP..."
            local zip_url="https://github.com/TheConflux-Core/conflux-lens/archive/refs/heads/main.zip"
            local tmp_zip
            tmp_zip=$(mktemp)
            curl -fsSL "$zip_url" -o "$tmp_zip" || {
                err "Failed to download ZIP"
                exit 1
            }
            mkdir -p "$repo_dir"
            if command -v unzip &>/dev/null; then
                unzip -qo "$tmp_zip" -d "$(dirname "$repo_dir")" || {
                    err "Failed to extract ZIP"
                    exit 1
                }
                mv "$(dirname "$repo_dir")/conflux-lens-main"/* "$repo_dir"/ 2>/dev/null || true
                rm -rf "$(dirname "$repo_dir")/conflux-lens-main"
            else
                err "Neither git nor unzip available. Install one and re-run."
                rm -f "$tmp_zip"
                exit 1
            fi
            rm -f "$tmp_zip"
            ok "Downloaded and extracted ZIP"
        fi
    fi

    INSTALL_DIR="$repo_dir"
}

# ─── Install Dependencies ────────────────────────────────────────────────────
install_deps() {
    cd "$INSTALL_DIR"

    if [ -d "node_modules" ]; then
        ok "Node modules already installed"
        # Still check if we need to update
        if [ -f "package-lock.json" ]; then
            local lock_age
            lock_age=$(stat -c %Y "package-lock.json" 2>/dev/null || stat -f %m "package-lock.json" 2>/dev/null)
            local modules_age
            modules_age=$(stat -c %Y "node_modules" 2>/dev/null || stat -f %m "node_modules" 2>/dev/null)
            if [ "$lock_age" -gt "$modules_age" ] 2>/dev/null; then
                info "Dependencies out of date — updating..."
                npm install 2>&1 | tail -3
                ok "Dependencies updated"
            fi
        fi
    else
        info "Installing npm dependencies..."
        npm install 2>&1 | tail -3
        ok "Dependencies installed"
    fi
}

# ─── Build ────────────────────────────────────────────────────────────────────
build_project() {
    cd "$INSTALL_DIR"

    if [ -d "dist" ] && [ -f "dist/index.js" ]; then
        ok "Project already built"
        info "Refreshing build..."
        npm run build 2>&1 | tail -3
        ok "Build refreshed"
    else
        info "Building project..."
        npm run build 2>&1 | tail -3
        ok "Build complete"
    fi
}

# ─── HTTPS Certificate Setup ─────────────────────────────────────────────────
setup_ca() {
    cd "$INSTALL_DIR"
    local ca_path="$HOME/.conflux-lens/ca.pem"

    if [ -f "$ca_path" ]; then
        ok "HTTPS CA certificate already exists"
    else
        info "Generating HTTPS CA certificate for MITM interception..."
        npx ts-node src/scripts/setup-trust.ts setup 2>&1 || {
            warn "Could not generate CA cert automatically"
            info "You can set it up later: cd $INSTALL_DIR && npm run setup-trust setup"
            return
        }
        ok "CA certificate generated"
    fi
}

# ─── Shell Profile Configuration ─────────────────────────────────────────────
configure_profile() {
    local ca_path="$HOME/.conflux-lens/ca.pem"
    local ca_line="export NODE_EXTRA_CA_CERTS=\"\$HOME/.conflux-lens/ca.pem\""
    local proxy_line_http="export HTTP_PROXY=\"http://localhost:9876\""
    local proxy_line_https="export HTTPS_PROXY=\"http://localhost:9876\""

    if [ ! -f "$ca_path" ]; then
        warn "CA certificate not found — skipping profile config"
        return
    fi

    sub_header "Environment Configuration"

    echo ""
    info "To use Conflux Lens, set these environment variables:"
    echo ""
    printf "  ${BOLD}%s${NC}\n" "$ca_line"
    printf "  ${BOLD}%s${NC}\n" "$proxy_line_http"
    printf "  ${BOLD}%s${NC}\n" "$proxy_line_https"
    echo ""

    if prompt_yn "Add these to your shell profile (permanent)?" "y"; then
        # Detect shell
        local shell_rc=""
        if [ -n "${ZSH_VERSION:-}" ]; then
            shell_rc="$HOME/.zshrc"
        elif [ -n "${BASH:-}" ]; then
            # Check for .bash_profile on macOS, .bashrc on Linux
            if [ "$(uname)" = "Darwin" ]; then
                shell_rc="$HOME/.bash_profile"
                [ -f "$shell_rc" ] || shell_rc="$HOME/.zshrc"
            else
                shell_rc="$HOME/.bashrc"
            fi
        elif [ -f "$HOME/.config/fish/config.fish" ]; then
            shell_rc="$HOME/.config/fish/config.fish"
        else
            shell_rc="$HOME/.profile"
        fi

        # Check if already configured
        if grep -q "NODE_EXTRA_CA_CERTS.*conflux-lens" "$shell_rc" 2>/dev/null; then
            ok "Already configured in $shell_rc"
        else
            {
                echo ""
                echo "# Conflux Lens — HTTPS CA cert for MITM interception"
                echo "$ca_line"
                echo ""
                echo "# Conflux Lens — Proxy for AI agent traffic inspection"
                echo "$proxy_line_http"
                echo "$proxy_line_https"
            } >> "$shell_rc"
            ok "Added to ${BOLD}$shell_rc${NC}"
            info "Run:  source $shell_rc"
        fi
    else
        info "For current session only, run:"
        echo ""
        printf "  ${BOLD}%s${NC}\n" "export NODE_EXTRA_CA_CERTS=\"\$HOME/.conflux-lens/ca.pem\""
        printf "  ${BOLD}%s${NC}\n" "export HTTP_PROXY=\"http://localhost:9876\""
        printf "  ${BOLD}%s${NC}\n" "export HTTPS_PROXY=\"http://localhost:9876\""
        echo ""
    fi
}

# ─── Next Steps ──────────────────────────────────────────────────────────────
show_next_steps() {
    sub_header "🎯 Next Steps"

    cat << 'NEXT'

  1. Start the proxy:
     cd ~/.conflux-lens
     npm start

  2. Open the dashboard:
     http://localhost:3000

  3. Configure your AI agent:
     HTTP_PROXY=http://localhost:9876
     HTTPS_PROXY=http://localhost:9876
     NODE_EXTRA_CA_CERTS=$HOME/.conflux-lens/ca.pem

  4. Install the SDK in your project:
     npm install @conflux/sdk ws

NEXT
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
    clear 2>/dev/null || true

    # ── Header ──
    show_banner
    echo ""
    printf "  ${BOLD}ℹ${NC}  Conflux Lens v0.3.0 — One-Line Installer\n"
    printf "  ${DIM}   https://github.com/TheConflux-Core/conflux-lens${NC}\n"
    echo ""
    printf "  ${YELLOW}About:${NC} LLM-aware HTTP proxy for inspecting AI agent API traffic.\n"
    printf "  ${YELLOW}       Monitor requests, responses, tokens, costs, tool calls & streams.\n"

    # ── Stage 1: Checks ──
    sub_header "🔍 Prerequisites"
    check_not_root
    check_prereqs

    # ── Stage 2: Clone ──
    sub_header "📥 Download"
    clone_repo

    # ── Stage 3: Install ──
    sub_header "📦 Install Dependencies"
    install_deps

    # ── Stage 4: Build ──
    sub_header "🔨 Build"
    build_project

    # ── Stage 5: HTTPS CA ──
    sub_header "🔐 HTTPS Interception Setup"
    setup_ca

    # ── Stage 6: Profile ──
    configure_profile

    # ── Complete ──
    header
    printf "${GREEN}${BOLD}  ✅ Conflux Lens installed successfully!${NC}\n"
    header

    show_next_steps

    # Check for npm start readiness
    local bin_path="$INSTALL_DIR/node_modules/.bin"
    if [ -f "$INSTALL_DIR/dist/index.js" ]; then
        ok "Ready to launch! Run:  cd ~/.conflux-lens && npm start"
    else
        warn "Build output not found — try:  cd ~/.conflux-lens && npm run build && npm start"
    fi
    echo ""
}

main "$@"
