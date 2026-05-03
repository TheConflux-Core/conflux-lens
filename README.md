# AI Agent Proxy

A lightweight, self-hosted HTTP proxy designed to inspect and debug AI agent API traffic. Like BurpSuite, but purpose-built for LLM APIs — shows every request and response, token usage, costs, and more.

## Why This Exists

AI agents (OpenClaw, Hermes, etc.) make HTTP requests to LLM APIs, but you see only the *results*, not the *communication*. This proxy gives you full visibility into:

- Exact system prompts being constructed
- Tools/context being injected  
- Raw JSON payloads sent to OpenAI/Anthropic/etc.
- Responses, token counts, timing, retries, and errors
- Multi-step agent loops (request → tool call → request)

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start the proxy
npm start

# Configure your agents
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876

# Open dashboard
open http://localhost:3000
```

## Architecture

- **Proxy Server** (`localhost:9876`) — HTTP/HTTPS intercepting proxy
- **WebSocket Server** (`localhost:9877`) — Real-time push to dashboard
- **Dashboard** (`localhost:3000`) — Web UI with live request feed

## Features

### Core
- ✅ HTTP/HTTPS proxy with full request/response capture
- ✅ Real-time web dashboard with live feed
- ✅ WebSocket push updates
- ✅ Request history and details view
- ✅ JSON body pretty-printing
- ✅ Filter by method, URL, status code
- ✅ Export all captures to JSON

### LLM-Specific
- ✅ Token usage display (prompt, completion, total)
- ✅ Cost estimation
- ✅ System prompt highlighting
- ✅ Tool call visualization
- ✅ Multi-turn conversation tracking
- ✅ Streaming response support (SSE)
- ✅ Model detection

## Usage

### Configure Any Agent

Set environment variables:
```bash
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876
```

Or configure per-agent:
- **OpenClaw**: Set `proxy` in config
- **Hermes**: Set `proxy` in config
- **Any SDK**: Most respect `HTTP_PROXY`/`HTTPS_PROXY`

### Dashboard

Navigate to `http://localhost:3000` to see:
- Live list of all requests
- Click any request to inspect full details
- Request/response headers and bodies
- Token usage and cost estimates
- Filter by errors, LLM APIs, slow requests
- Search by URL, method, body content

### HTTPS Interception

For HTTPS traffic, the proxy supports MITM decryption using dynamically-generated
CA certificates (similar to BurpSuite).

**Setup:**
```bash
# Generate CA certificate
npm run setup-trust setup

# Configure trust (for Node.js apps)
export NODE_EXTRA_CA_CERTS="~/.ai-agent-proxy/ca.pem"

# Verify
npm run setup-trust verify
```

When configured, the proxy:
1. Generates a root CA certificate (`~/.ai-agent-proxy/ca.pem`) on first run
2. Creates per-host certificates signed by the CA for each CONNECT request  
3. Negotiates TLS with clients using the generated certs
4. Establishes separate TLS connections to upstream servers
5. Decrypts, logs, and re-encrypts traffic

See `src/proxy/README.md` for technical details.

## Development

### Project Structure

```
ai-agent-proxy/
├── src/
│   ├── index.ts              # Entry point (proxy + dashboard)
│   ├── dashboard/
│   │   ├── index.html        # Dashboard UI
│   │   ├── app.js            # Dashboard client logic
│   │   ├── style.css         # Dashboard styles
│   │   └── server.ts         # Static file server
│   └── (proxy logic in index.ts)
├── dist/                     # Compiled output
├── design/                   # Design documents
├── research/                 # Research notes
└── docs/                     # Documentation
```

### Build & Run

```bash
# TypeScript compile
npm run build

# Start (production)
npm start

# Dev mode (with ts-node)
npm run dev
```

### Testing

```bash
# Test proxy passthrough
curl -x http://localhost:9876 http://example.com

# Test LLM API passthrough
curl -x http://localhost:9876 \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5","messages":[{"role":"user","content":"hi"}]}' \
  http://your-llm-server:9999/v1/chat/completions
```

## Comparison

| Feature | BurpSuite Pro | AI Agent Proxy |
|---------|--------------|----------------|
| Price | $449/year | Free (open source) |
| HTTP Proxy | ✅ | ✅ |
| HTTPS Intercept | ✅ | ✅ (Phase 2) |
| LLM Token Display | ❌ | ✅ |
| Cost Tracking | ❌ | ✅ |
| Tool Call View | ❌ | ✅ |
| System Prompt View | ❌ | ✅ |
| Streaming Support | ❌ | ✅ |
| Browser Extension | N/A | Not needed |
| Agent Framework Support | Manual | Universal |

## Key Differences from BurpSuite/FoxyProxy

**No browser extension needed** — AI agents aren't browser-based. They're Node.js/Python processes making HTTP requests via code libraries. A browser extension like FoxyProxy only controls browser proxy settings, but agents use OS-level proxy settings or environment variables.

**LLM-aware** — Unlike generic HTTP proxies, this understands LLM API patterns and displays token usage, costs, system prompts, and tool calls specifically.

## Roadmap

- [x] Phase 1: HTTP proxy with capture and dashboard
- [x] Phase 2: HTTPS interception with CA cert
- [ ] Phase 3: Intercept & modify requests
- [ ] Phase 4: Library-level interception (npm package)
- [ ] Phase 5: Docker support

## License

MIT

## HTTPS Interception Setup

The proxy supports HTTPS interception using a dynamically generated CA certificate.

### First-Time Setup

```bash
# Generate CA certificate
npm run setup-trust setup
```

This will:
1. Generate a root CA certificate at `~/.ai-agent-proxy/ca.pem`
2. Display the certificate fingerprint
3. Print setup instructions

To complete setup, configure Node.js to trust this CA:

```bash
# For current session
export NODE_EXTRA_CA_CERTS="~/.ai-agent-proxy/ca.pem"

# For persistent configuration (adds to ~/.bashrc or ~/.zshrc)
npm run setup-trust setup
# Then follow instructions to add to your shell RC file
```

### Verify Configuration

```bash
npm run setup-trust verify
```

### Available Commands

- `npm run setup-trust setup`    - Generate CA and print instructions
- `npm run setup-trust verify`   - Check trust configuration
- `npm run setup-trust fingerprint` - Show CA fingerprint
- `npm run setup-trust help`     - Show all commands

### How It Works

When an HTTPS CONNECT request is received:
1. The proxy responds with "200 Connection Established"
2. A MITM TLS server is created for the specific hostname
3. The client performs TLS handshake with the proxy (using a cert signed by our CA)
4. The proxy establishes a separate TLS connection to the real server
5. Traffic is decrypted at the proxy, logged, then re-encrypted to upstream

### Notes

- The CA certificate is stored in `~/.ai-agent-proxy/ca.pem`
- Generated host certificates are cached in memory for performance
- Non-Node.js applications require their own trust store configuration
- The dashboard shows all HTTPS CONNECT tunneling activity

