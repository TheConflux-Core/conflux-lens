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

## Quick Start

```bash
# Install
npm install

# Build (SDK builds automatically)
npm run build

# Start the proxy
npm start

# Configure your agents
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876

# Open dashboard
open http://localhost:3000
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

```bash
npm install @conflux/sdk ws
```

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

---

## HTTPS Interception

For HTTPS traffic, Conflux Lens generates a dynamic CA certificate and performs MITM decryption.

```bash
# First time: generate CA certificate
npm run setup-trust setup

# Then configure Node.js to trust it
export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"
```

See `src/proxy/README.md` for full HTTPS setup instructions.

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

## Development

```bash
# Build TypeScript
npm run build

# Run in dev mode
npm run dev

# Run tests
npm test

# Setup HTTPS trust
npm run setup-trust setup
```

---

## License

MIT — © 2026 The Conflux, LLC