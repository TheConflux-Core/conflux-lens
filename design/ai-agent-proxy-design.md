# AI Agent Proxy — Design Document
## "What the hell is actually being sent to these APIs?!"
### May 2, 2026

---

## 1. THE PROBLEM

You're running AI agents (OpenClaw, Hermes, etc.) and they're making LLM API calls. You have **zero visibility** into:

- What exact system prompt is being constructed
- What tools/context are being injected
- The exact JSON payload sent to OpenAI/Anthropic/etc.
- The raw response coming back
- Token counts, timing, retries, errors
- How multi-step agent loops work (request → tool call → request → ...)

The frameworks abstract all of this away. You see the *results* but not the *communication layer*.

---

## 2. THE VISION

A lightweight, always-on proxy that sits between your AI agents and the cloud LLM APIs, showing you **every single request and response in real-time** — like BurpSuite, but purpose-built for AI agent traffic.

**Core principles:**
- See everything, always
- Zero impact on agent performance
- No browser extension needed
- Intercept optional (view-only by default)
- Built for the AI agent era

---

## 3. ARCHITECTURE

### 3.1 Recommended Approach: Dual-Mode Proxy

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR MACHINE                              │
│                                                              │
│  ┌──────────┐     ┌──────────────────────┐     ┌─────────┐ │
│  │  Hermes   │────▶│   AI Agent Proxy     │────▶│ OpenAI  │ │
│  │  Agent    │     │   (localhost:9876)   │     │ API     │ │
│  └──────────┘     │                      │     └─────────┘ │
│                    │  • Captures request   │                  │
│  ┌──────────┐     │  • Shows in UI        │     ┌─────────┐ │
│  │ OpenClaw │────▶│  • Forwards to API    │────▶│Anthropic│ │
│  │  Agent    │     │  • Captures response  │     │ API     │ │
│  └──────────┘     │  • Shows in UI        │     └─────────┘ │
│                    │                      │                  │
│                    │  ┌────────────────┐  │     ┌─────────┐ │
│                    │  │  Web Dashboard  │  │────▶│ Google  │ │
│                    │  │  (localhost:3000)│  │     │ Gemini  │ │
│                    │  └────────────────┘  │     └─────────┘ │
│                    └──────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Two Capture Modes

**Mode 1: Transparent Proxy (Universal)**
- Works with ANY agent/framework
- Set `HTTP_PROXY=http://localhost:9876` or configure agent to use proxy
- Captures all HTTP(S) traffic
- For HTTPS: generate a CA cert, install in Node.js trust store
- Pros: Universal, works with everything
- Cons: Catches all traffic, HTTPS setup needed

**Mode 2: Library-Level Interception (Surgical)**
- Monkey-patches `fetch()`, `axios`, `openai` SDK, etc.
- Only captures LLM API calls
- No proxy setup needed
- Sees requests BEFORE encryption (cleanest data)
- Pros: Zero config, sees exact payload, no HTTPS issues
- Cons: Language-specific, may miss some traffic

**Recommendation: Start with Mode 1 (proxy), add Mode 2 later.**

---

## 4. TECHNICAL DESIGN

### 4.1 The Proxy Server

**Tech choice: Node.js or Python**

Both are excellent. Recommendation: **Node.js** because:
- AI agent ecosystem is Node.js heavy
- Easy to monkey-patch `fetch` and `http` modules
- Great WebSocket support for real-time UI updates
- `http-proxy-middleware` makes this trivial

**Core proxy features:**
1. HTTP proxy server on `localhost:9876`
2. HTTPS interception with dynamically generated CA cert
3. Request/response capture with full body
4. WebSocket server for real-time UI push
5. Optional intercept (hold requests)

### 4.2 HTTPS Interception

This is the trickiest part. For LLM APIs (api.openai.com, api.anthropic.com, etc.):

1. Generate a root CA certificate on first run
2. Install it in Node.js trust store: `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`
3. For each HTTPS connection, dynamically generate a cert signed by our CA
4. Decrypt → inspect → re-encrypt → forward

**Alternative (simpler)**: Don't intercept HTTPS at the proxy level. Instead:
- Use the library-level approach to capture before encryption
- Or just capture the metadata (URL, headers, timing) from the proxy
- For body content, rely on Mode 2

### 4.3 The Web Dashboard

A real-time web UI showing:

```
┌─────────────────────────────────────────────────────────────┐
│  🔍 AI Agent Proxy                              [Intercept: OFF] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  #  Time     Method  URL                            Status  Size │
│  ─────────────────────────────────────────────────────────── │
│  1  14:23:01 POST   https://api.openai.com/v1/chat/... 200   2.3KB │
│  2  14:23:03 POST   https://api.anthropic.com/v1/mes... 200   1.8KB │
│  3  14:23:05 GET    https://api.openai.com/v1/models    200   4.1KB │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  Request #1 — POST api.openai.com/v1/chat/completions       │
│  ────────────────────────────────────────────────────────── │
│  Headers:                                                    │
│    Authorization: Bearer sk-...                              │
│    Content-Type: application/json                            │
│                                                              │
│  Body (JSON):                                                │
│  {                                                           │
│    "model": "gpt-4",                                        │
│    "messages": [                                             │
│      {                                                       │
│        "role": "system",                                     │
│        "content": "You are OWL, developed by ZOO..."        │
│      },                                                      │
│      {                                                       │
│        "role": "user",                                       │
│        "content": "I want to talk about building..."         │
│      }                                                       │
│    ],                                                        │
│    "tools": [...],                                           │
│    "temperature": 0.7                                        │
│  }                                                           │
│                                                              │
│  ────────────────────────────────────────────────────────── │
│  Response — 200 OK (1.2s)                                   │
│                                                              │
│  Body (JSON):                                                │
│  {                                                           │
│    "choices": [{                                             │
│      "message": {                                            │
│        "role": "assistant",                                  │
│        "content": "This is a fantastic idea...",             │
│        "tool_calls": [...]                                   │
│      }                                                       │
│    }],                                                       │
│    "usage": {                                                │
│      "prompt_tokens": 15234,                                 │
│      "completion_tokens": 892,                               │
│      "total_tokens": 16126                                   │
│    }                                                         │
│  }                                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 LLM-Specific Features

Beyond generic proxy features, this tool should understand LLM APIs:

1. **Pretty-print JSON bodies** with syntax highlighting
2. **Token counting display** (from `usage` field in responses)
3. **Cost estimation** (based on model + token counts)
4. **System prompt extraction** — highlight the system message separately
5. **Tool call visualization** — show tool calls and results clearly
6. **Multi-turn tracking** — group related requests (agent loops)
7. **Model detection** — identify which model is being used
8. **Streaming response support** — capture SSE (Server-Sent Events) streams

### 4.5 Intercept Feature (Phase 2)

When intercept is ON:
1. Proxy holds the request
2. Dashboard shows the request with editable fields
3. You can:
   - **Forward**: Send as-is
   - **Modify & Forward**: Edit the JSON body, headers, etc.
   - **Drop**: Cancel the request
   - **Replay**: Send it again later

This lets you:
- See what the agent is about to send BEFORE it sends it
- Modify prompts on the fly
- Test how the LLM responds to different inputs
- Debug agent behavior

---

## 5. IMPLEMENTATION PLAN

### Phase 1: Minimal Viable Proxy (Week 1)
- [ ] HTTP proxy server (Node.js, `http-proxy`)
- [ ] Capture request/response (URL, headers, body)
- [ ] Simple web dashboard with live feed
- [ ] WebSocket for real-time updates
- [ ] JSON pretty-printing

### Phase 2: HTTPS Support (Week 2)
- [ ] Generate CA certificate
- [ ] Dynamic certificate generation per host
- [ ] Install CA in Node.js trust store
- [ ] HTTPS interception working

### Phase 3: LLM-Specific Features (Week 3)
- [ ] Token usage display
- [ ] Cost estimation
- [ ] System prompt highlighting
- [ ] Tool call visualization
- [ ] Streaming response support (SSE)
- [ ] Multi-turn conversation grouping

### Phase 4: Intercept & Modify (Week 4)
- [ ] Intercept toggle
- [ ] Request editor
- [ ] Forward/Drop/Modify actions
- [ ] Request replay

### Phase 5: Polish (Week 5+)
- [ ] Filter/search
- [ ] Export to file
- [ ] Dark mode (obviously)
- [ ] Library-level interception mode
- [ ] Docker support

---

## 6. TECH STACK RECOMMENDATION

| Component | Technology | Why |
|-----------|-----------|-----|
| Proxy Server | Node.js + `http-proxy` | Native HTTP proxy, easy monkey-patching |
| Dashboard | React or vanilla JS + WebSocket | Real-time updates, simple |
| Styling | Tailwind CSS or plain CSS | Fast development |
| HTTPS | `node-forge` or `pem` | Certificate generation |
| Packaging | `pkg` or `nexe` | Single executable distribution |

---

## 7. EXISTING ALTERNATIVES (and why they're not enough)

| Tool | What it does | Why it's not enough |
|------|-------------|-------------------|
| **BurpSuite** | General HTTP proxy | Expensive ($449/yr), not LLM-aware, heavy |
| **mitmproxy** | Open-source HTTP proxy | Great but not LLM-specific, CLI-focused |
| **Charles Proxy** | HTTP proxy (macOS) | $50, not LLM-aware, macOS-focused |
| **Wireshark** | Network packet capture | Too low-level, can't easily decrypt TLS |
| **LangSmith** | LLM tracing | Only works with LangChain, SaaS, limited |
| **Langfuse** | LLM observability | Self-hosted option exists but is heavy, needs SDK integration |
| **Helicone** | LLM proxy/observability | SaaS, limited free tier, not self-hosted |
| **OpenLLMetry** | LLM telemetry | OpenTelemetry-based, needs SDK integration |

**The gap**: A lightweight, self-hosted, LLM-aware proxy that works with ANY agent framework without requiring SDK integration. Just point your agent at it and see everything.

---

## 8. DO WE NEED A BROWSER EXTENSION?

**Short answer: No.**

**Long answer:**
- AI agents are NOT browser-based — they're server-side processes
- They make HTTP requests via code libraries, not through the browser
- A browser extension like FoxyProxy only controls browser proxy settings
- Our proxy needs to be configured at the OS or process level, not browser level

**When a browser extension WOULD make sense:**
- If you wanted to also capture browser-based AI tools (ChatGPT web, Claude web, etc.)
- This could be a Phase 2 addition — a simple extension that routes browser traffic through the proxy
- But for the core use case (agent frameworks), it's unnecessary

---

## 9. SUMMARY

**What we're building**: A lightweight, self-hosted, LLM-aware HTTP proxy with a real-time web dashboard that shows you every request and response between your AI agents and cloud LLM APIs.

**What makes it different**: Purpose-built for AI agents, not generic web security. Understands LLM APIs, shows token usage, costs, system prompts, and tool calls.

**What we DON'T need**: A browser extension. The agents aren't in the browser.

**How to start**: A simple Node.js HTTP proxy with a WebSocket-powered web dashboard. Add HTTPS interception, then LLM-specific features, then intercept capability.

**Estimated effort**: 1-2 weeks for a solid v1.
