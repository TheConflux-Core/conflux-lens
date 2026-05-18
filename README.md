# 🔍 Conflux Lens

> LLM-aware HTTP proxy for inspecting and debugging AI agent API traffic.

[![npm version](https://img.shields.io/npm/v/@conflux/sdk)](https://www.npmjs.com/package/@conflux/sdk)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Conflux Lens** is a purpose-built HTTP/HTTPS proxy for developers building with AI agents. Like BurpSuite, but designed specifically for LLM APIs — it shows you every request, response, token count, cost, system prompt, and tool call in real time.

---

## Why This Exists

AI agents make HTTP requests to LLM APIs, but you only see the *results*, not the *communication*. Conflux Lens gives you full visibility into:

- **Exact system prompts** being constructed and sent
- **Tools and context** being injected into requests
- **Token usage and cost** per call and cumulative
- **Tool call chains** and multi-step agent loops
- **Raw JSON payloads** sent to OpenAI, Anthropic, and any LLM API
- **Streaming responses** (SSE) rendered live

---

## One-Line Install 🚀

```bash
# macOS / Linux
curl -fsSL https://openclaw.ai/install.sh | bash

# Windows PowerShell
powershell -c "irm https://openclaw.ai/install.ps1 | iex"
```

This installs everything: clones the repo, installs deps, builds the project,
generates HTTPS certificates, and optionally configures your shell profile.

---

## Quick Start (All Platforms)

### Prerequisites
- **Node.js 18+** (check with `node --version`)
- **npm** (comes with Node.js)

### Step 1: Clone & Install

```bash
git clone https://github.com/TheConflux-Core/conflux-lens.git
cd conflux-lens
npm install
```

### Step 2: Build

```bash
npm run build
```

This builds the SDK first, then the main app.

### Step 3: Set Up HTTPS Interception (One-Time)

Conflux Lens uses MITM (Man-in-the-Middle) to decrypt HTTPS traffic for inspection. You need to generate a CA certificate and trust it.

**For Node.js applications (recommended for testing):**
```bash
npm run setup-trust setup
```

Follow the printed instructions to configure `NODE_EXTRA_CA_CERTS`.

**For browser testing:**
You'll need to import the CA certificate (`~/.conflux-lens/ca.pem`) into your browser or system trust store. See [HTTPS Setup](#https-setup) below.

### Step 4: Start the Proxy

```bash
npm start
```

You should see:
```
=== Conflux Lens Starting (SDK-Integrated) ===

🔐 HTTPS Interception: Ready
   CA: /home/username/.conflux-lens/ca.pem
   Fingerprint: AB:CD:EF:...

🚀 Proxy Server (SDK): http://localhost:9876
   WebSocket:    ws://localhost:9877
📊 Dashboard:   http://localhost:3000

--- Configuration ---
   HTTP_PROXY=http://localhost:9876
   HTTPS_PROXY=http://localhost:9876

   For HTTPS interception, configure agents to trust the CA.
   See dashboard for live request inspection.

=== Ready ===
```

### Step 5: Configure Your Client

**For Node.js apps:**
```bash
# macOS/Linux:
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876
export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"

# Windows PowerShell:
$env:HTTP_PROXY="http://localhost:9876"
$env:HTTPS_PROXY="http://localhost:9876"
$env:NODE_EXTRA_CA_CERTS="$env:USERPROFILE\.conflux-lens\ca.pem"
```

**For browsers:**
1. Open browser proxy settings
2. Set HTTP and HTTPS proxy to `localhost:9876`
3. Import CA cert: `~/.conflux-lens/ca.pem` (or `%USERPROFILE%\.conflux-lens\ca.pem` on Windows)

### Step 6: Open Dashboard

```
http://localhost:3000
```

You'll see live HTTP/HTTPS requests flowing through the proxy.

---

## Platform-Specific Instructions

### Windows (PowerShell)

```powershell
# 1. Clone
git clone https://github.com/TheConflux-Core/conflux-lens.git
cd conflux-lens

# 2. Install
npm install

# 3. Build
npm run build

# 4. Setup HTTPS (run as Administrator if possible)
npm run setup-trust setup

# The setup will print something like:
#   $env:NODE_EXTRA_CA_CERTS="C:\Users\YourName\.conflux-lens\ca.pem"
# Run that command in your PowerShell session.

# 5. Start
npm start

# 6. Open dashboard
start http://localhost:3000

# 7. Test with Node.js app
$env:HTTP_PROXY="http://localhost:9876"
$env:HTTPS_PROXY="http://localhost:9876"
$env:NODE_EXTRA_CA_CERTS="C:\Users\YourName\.conflux-lens\ca.pem"
node your-app.js
```

### Windows Subsystem for Linux (WSL)

```bash
# In WSL terminal:
# 1. Clone
git clone https://github.com/TheConflux-Core/conflux-lens.git
cd conflux-lens

# 2. Install
npm install

# 3. Build
npm run build

# 4. Setup HTTPS
npm run setup-trust setup

# Follow the printed instructions:
#   export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"

# 5. Start
npm start

# 6. Open dashboard (from Windows browser - WSL is at localhost)
# In Windows browser: http://localhost:3000

# 7. Test with Node.js app (in WSL)
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876
export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"
node your-app.js
```

**Note for WSL:** If testing from Windows apps/browsers, use `localhost:9876` as the proxy. WSL and Windows share the same localhost.

### macOS / Linux

```bash
# 1. Clone
git clone https://github.com/TheConflux-Core/conflux-lens.git
cd conflux-lens

# 2. Install
npm install

# 3. Build
npm run build

# 4. Setup HTTPS
npm run setup-trust setup

# Follow the printed instructions:
#   export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"
# For persistent config:
#   echo 'export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"' >> ~/.bashrc  # or ~/.zshrc

# 5. Start
npm start

# 6. Open dashboard
open http://localhost:3000  # macOS
# xdg-open http://localhost:3000  # Linux

# 7. Test with Node.js app
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876
export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"
node your-app.js
```

---

## HTTPS Setup

Conflux Lens decrypts HTTPS traffic using a locally-generated CA certificate. Here's how to trust it on different platforms:

### Node.js Applications (All Platforms)

```bash
# Generate CA cert (one-time)
npm run setup-trust setup

# Use the printed command to set NODE_EXTRA_CA_CERTS
# macOS/Linux:
export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"

# Windows PowerShell:
$env:NODE_EXTRA_CA_CERTS="$env:USERPROFILE\.conflux-lens\ca.pem"

# Verify:
npm run setup-trust verify
```

### Browsers

#### Chrome/Edge (All Platforms)
1. Navigate to `chrome://settings/certificates`
2. Go to "Authorities" tab
3. Click "Import" and select `~/.conflux-lens/ca.pem`
4. Check "Trust this certificate for identifying websites"
5. Restart browser

#### Firefox (All Platforms)
1. Navigate to `about:preferences#privacy`
2. Scroll to "Certificates" → Click "View Certificates"
3. Go to "Authorities" tab → Click "Import"
4. Select `~/.conflux-lens/ca.pem`
5. Check "Trust this CA to identify websites"
6. Restart Firefox

### Windows (System-Wide)
```powershell
# Run as Administrator:
[System.Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', 'C:\Users\YourName\.conflux-lens\ca.pem', 'User')

# For system-wide cert trust:
# 1. Open "Manage computer certificates" (certmgr.msc)
# 2. Right-click "Trusted Root Certification Authorities" → All Tasks → Import
# 3. Select C:\Users\YourName\.conflux-lens\ca.pem
```

### macOS (System-Wide)
```bash
# Add to system keychain (requires sudo)
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.conflux-lens/ca.pem
```

---

## Architecture

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Your App    │────▶│  Conflux Lens        │────▶│  LLM API    │
│  (AI Agent)  │◀────│  localhost:9876       │◀────│  (OpenAI,   │
└─────────────┘     │                      │     │  etc.)      │
                    │  Dashboard :3000     │     └─────────────┘
                    │  WebSocket  :9877     │
                    └──────────────────────┘
```

**Ports:**
- `9876` — HTTP/HTTPS proxy
- `9877` — WebSocket server (real-time push to dashboard)
- `3000` — Web dashboard

---

## Features

### Core Proxy
- ✅ Full HTTP/HTTPS request/response capture
- ✅ Real-time web dashboard with live feed
- ✅ WebSocket push (no polling)
- ✅ Request history and detail view
- ✅ JSON body pretty-printing
- ✅ Filter by method, URL, status code
- ✅ HAR export (HTTP Archive format)

### LLM-Specific
- ✅ Token usage display (prompt / completion / total)
- ✅ Cost estimation
- ✅ System prompt highlighting
- ✅ Tool call visualization
- ✅ Multi-turn conversation tracking
- ✅ Streaming response support (SSE)
- ✅ Model detection

### SDK (`@conflux/sdk`)
- ✅ Programmatic proxy server — start/stop in code
- ✅ HTTP/HTTPS interceptor — patch Node.js `http`/`https` modules directly (no proxy config needed)
- ✅ Breakpoint management — pause and inspect any request
- ✅ WebSocket real-time updates
- ✅ Full TypeScript types included

---

## SDK Package

Install the SDK separately:

```bash
npm install @conflux/sdk ws
```

### SDK Usage

```typescript
import { createProxyServer, createInterceptor, AgentClient } from '@conflux/sdk';

// Create a proxy server
const proxy = createProxyServer({ port: 9876 });
await proxy.start();

// Intercept HTTP/HTTPS calls directly (no proxy config needed)
const interceptor = createInterceptor({
  target: 'all',
  captureBody: true,
  onRequest: (ctx) => console.log('→', ctx.request.url),
  onResponse: (ctx) => console.log('←', ctx.response?.statusCode),
});
```

See `packages/sdk/examples/` for more examples.

---

## Development

```bash
# Build TypeScript
npm run build

# Run in dev mode (auto-rebuild)
npm run dev

# Run tests
npm test

# Setup HTTPS trust
npm run setup-trust setup

# Publish SDK to npm (maintainers only)
cd packages/sdk && npm publish
```

---

## Comparison

| Feature | BurpSuite Pro | Conflux Lens |
|---|---|---|
| Price | $449/yr | Free (open source) |
| HTTP Proxy | ✅ | ✅ |
| HTTPS Intercept | ✅ | ✅ |
| LLM Token Display | ❌ | ✅ |
| Cost Tracking | ❌ | ✅ |
| Tool Call View | ❌ | ✅ |
| System Prompt View | ❌ | ✅ |
| Streaming Support | ❌ | ✅ |
| Browser Extension | Required | Not needed |

---

## Troubleshooting

### "EADDRINUSE" Error
Another instance is already running on the port. Kill it:
```bash
# macOS/Linux:
lsof -i :9876 | grep LISTEN | awk '{print $2}' | xargs kill

# Windows PowerShell:
netstat -ano | findstr :9876
taskkill /PID <PID> /F
```

### HTTPS Traffic Not Decrypted
1. Verify CA cert exists: `ls ~/.conflux-lens/ca.pem`
2. Verify `NODE_EXTRA_CA_CERTS` is set: `echo $NODE_EXTRA_CA_CERTS`
3. Run verify: `npm run setup-trust verify`

### Build Fails
Make sure you have Node.js 18+:
```bash
node --version
```
If older, update from [nodejs.org](https://nodejs.org/).

---

## License

MIT — © 2026 The Conflux, LLC
