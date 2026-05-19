# Conflux Lens — Quick Start & Architecture

## Project Structure

```
conflux-lens/
├── research/
│   └── burp-foxyproxy-deep-dive.md    # Deep dive into Burp + FoxyProxy
├── design/
│   └── conflux-lens-design.md        # Full design document
├── docs/
│   ├── project-overview.md             # This file
│   └── (future: API docs, user guide)
├── src/
│   ├── index.ts                        # Entry point — proxy + dashboard server
│   └── dashboard/
│       ├── index.html                  # Dashboard web UI
│       ├── app.js                      # Dashboard client logic (real-time)
│       ├── style.css                   # Dashboard styling
│       └── server.ts                   # Static file server
├── dist/                               # Compiled output
│   ├── index.js                        # Main server (proxy + dashboard)
│   └── dashboard/                      # Static assets
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start (Phase 1 — MVP Running)

```bash
# Install
npm install

# Build
npm run build

# Start proxy + dashboard
npm start
# → Proxy:  http://localhost:9876
# → WS:     ws://localhost:9877
# → Dashboard: http://localhost:3000
```

Configure your AI agents:

```bash
# Method 1: Environment variables (most SDKs respect these)
export HTTP_PROXY=http://localhost:9876
export HTTPS_PROXY=http://localhost:9876

# Method 2: Agent-specific config
# OpenClaw: set proxy: "http://localhost:9876" in config
# Hermes: set proxy: "http://localhost:9876" in config

# Open dashboard
open http://localhost:3000
```

## Architecture Diagram

```
                         AI AGENT PROXY
                    ┌─────────────────────┐
                    │                     │
  Agent Traffic ──▶ │  HTTP Proxy         │ ──▶ LLM APIs
  (HTTP/HTTPS)      │  localhost:9876     │     (OpenAI, etc.)
                    │                     │
  Request/Response  │  • Captures full    │
       captured     │    request/response │
                    │  • WebSocket        │
    ┌──────────────▶│    push (port 9877) │
    │               │                     │
    │               └─────────┬───────────┘
    │                         ▼
    │               ┌─────────────────────┐
    └──────────────▶│  Web Dashboard      │
  Real-time UI      │  localhost:3000     │
                    │                     │
                    │  • Live request log │
                    │  • Token usage      │
                    │  • Cost tracking    │
                    │  • Request details  │
                    └─────────────────────┘
```

## What's Built (Phase 1)

### ✅ HTTP Proxy Server
- Intercepts HTTP/HTTPS traffic from AI agents
- Captures full request/response bodies (JSON, text, binary)
- Forwards requests to any LLM API (OpenAI, Anthropic, Google, custom)
- CONNECT tunneling for HTTPS passthrough
- WebSocket server for real-time dashboard updates

### ✅ Web Dashboard
- Live feed of all captured requests
- Click-to-inspect full request/response details
- Pretty-printed JSON with syntax highlighting
- Token usage display (prompt, completion, total)
- Cost estimation
- Filter by errors, LLM APIs, slow requests
- Search by URL, method, body content
- Export all captures to JSON

### ✅ LLM-Aware Features
- Token counting (from API responses)
- Cost estimation per request
- System prompt extraction/display
- Tool call visualization
- Multi-turn conversation tracking
- Streaming response support (SSE parsing)

## Technical Stack

| Component | Technology |
|-----------|-----------|
| Proxy Server | Node.js + `http-proxy` |
| WebSocket | `ws` |
| Dashboard UI | Vanilla JS + HTML/CSS |
| Styling | Custom CSS (dark theme, cyan/accent) |
| Build | TypeScript |

## Comparison: BurpSuite vs Conflux Lens

| Feature | BurpSuite Pro | Conflux Lens |
|---------|--------------|----------------|
| Price | $449/year | **Free** (open source) |
| HTTP Proxy | ✅ | ✅ |
| HTTPS Intercept | ✅ | ✅ (Phase 2) |
| Request/Response View | ✅ | ✅ |
| LLM Token Display | ❌ | ✅ |
| Cost Tracking | ❌ | ✅ |
| Tool Call View | ❌ | ✅ |
| System Prompt View | ❌ | ✅ |
| Streaming Support | ❌ | ✅ |
| Browser Extension | N/A (manual config) | **Not needed** |
| Weight | Heavy (Java) | **Lightweight** (Node.js) |
| Agent Framework Support | Manual config | **Universal** proxy |

## Why No Browser Extension?

**Critical insight**: AI agents are **NOT browser-based**.

- They're Node.js/Python processes running on your machine
- They make HTTP requests via code libraries (`fetch`, `axios`, `openai`, etc.)
- They go through the **OS/process network stack**, not the browser

A browser extension like FoxyProxy controls browser proxy settings — completely irrelevant for capturing agent traffic. Our proxy works at the OS level (via `HTTP_PROXY` env vars) or agent-level (via config), making it universal for any framework.

## How It Works

1. **Proxy Server** listens on `localhost:9876`
2. Agents configured with `HTTP_PROXY=http://localhost:9876`
3. Agent sends request → Proxy intercepts it
4. Proxy:
   - Captures request (method, URL, headers, body)
   - Forwards to target LLM API
   - Captures response (status, headers, body, timing)
   - Broadcasts via WebSocket to dashboard
5. **Dashboard** (localhost:3000) receives real-time updates
6. User clicks any request to inspect full details

## Implementation Status

| Phase | Status | Features |
|-------|--------|----------|
| **Phase 1: MVP** | ✅ **DONE** | HTTP proxy, capture, dashboard, token display |
| Phase 2: HTTPS | ⏳ Planned | CA cert, TLS interception |
| Phase 3: Intercept | ⏳ Planned | Hold & modify requests |
| Phase 4: Library Mode | ⏳ Planned | npm package for monkey-patching |
| Phase 5: Docker | ⏳ Planned | Containerized deployment |

## Testing

```bash
# Test proxy passthrough
curl -x http://localhost:9876 http://example.com

# Test with mock LLM API
python3 -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        r = {'choices':[{'message':{'content':'ok'}}],'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}}
        self.wfile.write(json.dumps(r).encode())
    def log_message(self,*a):pass
HTTPServer(('127.0.0.1',8888),H).serve_forever()
" &

curl -x http://localhost:9876 -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5","messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:8888/v1/chat/completions

# Check dashboard at http://localhost:3000
```

## License

MIT
