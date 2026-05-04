# BurpSuite & FoxyProxy Deep Dive Research
## Conflux Lens Project — Research Phase
### May 2, 2026

---

## 1. BURPSUITE PROXY — HOW IT WORKS

### 1.1 Core Architecture

BurpSuite Professional is a Java-based desktop application that functions as an **intercepting web proxy server**. It sits between your browser (or any HTTP client) and the destination web server, acting as a man-in-the-middle for HTTP and HTTPS traffic.

**The basic flow:**

```
Browser → Burp Proxy (localhost:8080) → Internet → Target Server
                ↑
         Intercept/Inspect/Modify
```

### 1.2 The Proxy Component

**How it works:**

1. **Proxy Listener**: Burp starts a local proxy server (default: `127.0.0.1:8080`). This is a standard HTTP/HTTPS proxy that speaks the HTTP protocol.

2. **Browser Configuration**: You configure your browser to use `127.0.0.1:8080` as its HTTP/HTTPS proxy. Every request the browser makes goes to Burp first.

3. **HTTP Requests**: For plain HTTP, Burp simply reads the raw TCP stream, parses the HTTP request, displays it, and forwards it to the destination server.

4. **HTTPS / TLS Interception**: This is where it gets clever:
   - When the browser connects to an HTTPS site through Burp, the browser sends a `CONNECT` request (HTTP tunneling).
   - Burp responds as if it's the destination server, presenting a **dynamically generated certificate** signed by Burp's own Certificate Authority (CA).
   - The browser must have Burp's CA certificate installed and trusted in its certificate store. Without this, you'd get certificate warnings.
   - Burp decrypts the TLS traffic, inspects/modifies the plaintext HTTP, then re-encrypts with its own certificate when forwarding to the real server.
   - This is essentially a **controlled man-in-the-middle attack** — the same technique used by malware, but here it's intentional and you control both ends.

5. **The CA Certificate**: BurpSuite generates a unique CA certificate when first installed. You export this (`cacert.der`) and import it into your browser/OS trust store. Every site-specific certificate Burp generates on-the-fly is signed by this CA, so the browser trusts them all.

### 1.3 The Intercept Feature

**How intercept works:**

1. When **Intercept is ON**, Burp holds every request (and optionally response) before forwarding it.
2. The request appears in the "Intercept" tab with full headers and body editable.
3. You can:
   - **Forward**: Send the request as-is (or with your edits)
   - **Drop**: Silently discard the request (browser will timeout/fail)
   - **Action**: Forward to other Burp tools, add to scope, etc.
4. When **Intercept is OFF**, all requests pass through transparently and are just logged.

**Implementation detail**: The proxy listener simply holds the TCP connection open and buffers the request data. It doesn't respond to the client until you click Forward or Drop. This is why the browser appears to "hang" when intercept is on.

### 1.4 Request/Response Viewing (HTTP History & Proxy Log)

**How the history works:**

1. Every request that passes through the proxy is logged with:
   - Request method, URL, headers, body
   - Response status code, headers, body
   - Timing information
   - MIME type, length, etc.

2. The data is stored in memory (and optionally to disk in a project file).

3. You can click any entry to see full request/response details in separate panels.

4. Features include:
   - Filtering by MIME type, status code, annotation, etc.
   - Search within requests/responses
   - Syntax highlighting for HTML, JSON, XML
   - Render tab to see HTML responses as a browser would

### 1.5 Key Technical Details

- **Written in Java** (cross-platform)
- Uses its own TLS stack for certificate generation
- Supports HTTP/1.1, HTTP/2, WebSockets
- Can handle multiple simultaneous connections (threaded)
- Project files (`.burp`) store session data
- Extensible via Java/Python/Ruby extensions (BApp Store)

---

## 2. FOXYPROXY BROWSER EXTENSION — HOW IT WORKS

### 2.1 Core Purpose

FoxyProxy is a **proxy management extension** for Firefox, Chrome, and other browsers. It doesn't replace BurpSuite — it's a **browser-side tool** that controls which proxy (if any) the browser uses for different requests.

### 2.2 How It Works

**Architecture:**

FoxyProxy is a **WebExtension** (browser add-on) that uses the browser's `proxy` API to dynamically control proxy settings.

**Two modes:**

1. **Manual Mode**: All traffic goes through a single proxy you specify (e.g., Burp at `127.0.0.1:8080`).

2. **Pattern-Based Mode (Standard/Plus)**: Different proxies are used based on URL patterns:
   - `*.example.com` → Proxy A
   - `*.internal.corp` → Proxy B (or direct)
   - Everything else → Direct connection (no proxy)

**How it integrates with the browser:**

- Uses the `browser.proxy` WebExtension API (Firefox) or `chrome.proxy` (Chrome)
- This API allows extensions to set proxy settings programmatically
- FoxyProxy essentially automates what you'd manually do in browser network settings

### 2.3 Technical Implementation

**Permissions required:**
- `proxy` — Core function, sets proxy configuration
- `webRequest` / `webRequestAuthProvider` — For proxy authentication
- `storage` — Save user preferences (proxy list, patterns)
- `tabs` — Get tab details for per-tab proxy settings
- `host permission: <all_urls>` — For proxy auth on any URL

**How pattern matching works:**
- FoxyProxy uses wildcard patterns (e.g., `*.example.com`) or regex
- For each new request, it checks the URL against all configured patterns
- The first matching pattern determines which proxy to use
- This happens before the request leaves the browser

### 2.4 Editions

| Edition | Features |
|---------|----------|
| **Basic** | Single proxy for all traffic, manual selection only |
| **Standard** | Pattern-based switching, multiple proxies, URL matching |
| **Plus** (discontinued) | Added network location detection (LAN IP-based switching) |

### 2.5 Key Technical Details

- Written in JavaScript (ES2022/ES13)
- Cross-platform: Firefox, Chrome, Edge, Brave, Chromium
- Uses Manifest V3 (required by Chrome since 2024)
- No remote code — all logic runs locally
- Open source (GPL 2.0)

---

## 3. HOW BURPSUITE + FOXYPROXY WORK TOGETHER

### 3.1 Typical Setup

```
Browser → FoxyProxy (decides routing) → Burp Proxy (127.0.0.1:8080) → Internet
                                       ↑
                              Inspect/Intercept/Log
```

**Configuration:**

1. Install BurpSuite, start proxy listener on `127.0.0.1:8080`
2. Install FoxyProxy extension
3. In FoxyProxy, add a new proxy: `127.0.0.1:8080`, type HTTP/HTTPS
4. Set FoxyProxy to pattern-based mode:
   - Target domains → route through Burp
   - Everything else → direct connection

### 3.2 Why Use Both?

- **FoxyProxy gives you control**: Only send specific traffic through Burp. Without it, you'd have to toggle Burp's intercept on/off constantly, or send ALL your browsing through Burp (slow, noisy logs).
- **Burp gives you the inspection**: FoxyProxy can't inspect traffic — it only routes it. Burp does the actual interception, logging, and modification.
- **Together**: You get surgical precision — only the traffic you care about goes to Burp, and you can inspect it fully.

### 3.3 Alternative to FoxyProxy

You can achieve the same thing by:
- Setting the browser's system-wide proxy to Burp (all traffic goes through)
- Using Burp's "Target Scope" to filter what gets logged
- Using browser's built-in proxy settings

FoxyProxy just makes it easier to switch between proxy configurations and set up URL-based rules.

---

## 4. KEY TAKEAWAYS FOR AI AGENT PROXY

### 4.1 What BurpSuite Does That We Need

| Feature | BurpSuite | Our Need |
|---------|-----------|----------|
| HTTP Proxy | Yes | Yes — capture API calls |
| HTTPS Intercept | Yes (CA cert) | Maybe — depends on TLS |
| Request/Response Viewing | Yes | **Core feature** |
| Intercept (hold & edit) | Yes | Nice-to-have |
| History Log | Yes | **Core feature** |
| Browser Extension | No (separate config) | **Not needed** (see below) |

### 4.2 What FoxyProxy Does That We DON'T Need

| Feature | FoxyProxy | Our Need |
|---------|-----------|----------|
| URL Pattern Routing | Yes | No — we want ALL API traffic |
| Multiple Proxy Switching | Yes | No — single proxy destination |
| Browser Extension | Yes | **No** (see below) |

### 4.3 Why We Don't Need a Browser Extension

**Critical insight**: AI agents (OpenClaw, Hermes, etc.) are **NOT browser-based**. They are:
- Node.js / Python / etc. processes running on your machine
- Making HTTP requests via libraries (`fetch`, `axios`, `httpx`, etc.)
- NOT going through the browser's networking stack

**Therefore:**
- A browser extension like FoxyProxy is **completely irrelevant** for capturing agent traffic
- We need to intercept at the **OS/process level**, not the browser level
- The agents are just HTTP clients — same as `curl` or `Postman`

### 4.4 How to Intercept Agent Traffic

Three approaches:

**Approach A: System Proxy (like Burp)**
- Set the OS proxy to `127.0.0.1:8080`
- All HTTP traffic from any app goes through
- Problem: HTTPS requires CA cert installation in Node.js trust store
- Problem: Catches ALL traffic, not just agent traffic

**Approach B: Environment Variables**
- Set `HTTP_PROXY` and `HTTPS_PROXY` env vars
- Many HTTP libraries respect these
- Problem: Not all libraries/apps respect them
- Problem: Same HTTPS issues

**Approach C: Library-Level Interception (Best for our use case)**
- Monkey-patch or wrap the HTTP library the agent uses
- Intercept at the application level before encryption
- See the EXACT request before it's sent
- No proxy needed, no CA cert needed
- This is what tools like `nock` (Node.js) or `responses` (Python) do for testing

---

## 5. REFERENCES

- PortSwigger Burp Suite Documentation: https://portswigger.net/burp/documentation
- FoxyProxy Browser Extension (v8+): https://github.com/foxyproxy/browser-extension
- FoxyProxy Legacy (v7.x): https://github.com/foxyproxy/firefox-extension
- MDN WebExtensions proxy API: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy
- Burp Extensions Montoya API: https://github.com/PortSwigger/burp-extensions-montoya-api
