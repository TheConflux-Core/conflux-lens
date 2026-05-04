# @conflux/sdk

> TypeScript SDK for programmatic HTTP/HTTPS interception and AI agent traffic monitoring.

This is the developer SDK for **Conflux Lens** — the LLM-aware HTTP proxy from The Conflux, LLC.

## Installation

```bash
npm install @conflux/sdk ws
```

## Features

- **Programmatic Proxy Server**: Start/stop proxy servers in code
- **HTTP/HTTPS Interceptor**: Patch Node.js `http`/`https` modules directly — no proxy config needed
- **AI Agent Client**: Register AI agents with the proxy, manage sessions
- **Breakpoint Management**: Pause requests and responses at configurable points
- **HAR Export**: Export all captured traffic as HAR format
- **WebSocket Real-time Updates**: Live traffic pushed to any client
- **HTTPS Interception**: MITM decryption via auto-generated CA certificates
- **Full TypeScript Types**: All types exported and documented

## Quick Start

### Basic Proxy Server

```typescript
import { createProxyServer } from '@conflux/sdk';
import * as fs from 'fs';

const proxy = createProxyServer({
  port: 9876,
  logLevel: 'info',
  autoConfigureTrust: true,
});

await proxy.start();

proxy.getWss().on('connection', (client) => {
  client.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'exchange') {
      const ex = msg.data;
      console.log(`${ex.request.method} ${ex.request.url}`);
      console.log(`Status: ${ex.response?.statusCode}`);
    }
  });
});

// Add a breakpoint
proxy.addBreakpoint({
  type: 'request',
  match: { method: 'POST', urlPattern: '/v1/chat' },
  enabled: true,
});

// Export HAR
const har = proxy.exportHar();
fs.writeFileSync('capture.har', JSON.stringify(har, null, 2));

await proxy.stop();
```

### HTTP/HTTPS Interceptor (No Proxy Config)

Intercepts `http.request` and `https.request` at the Node.js module level. No proxy URL or environment variables needed.

```typescript
import { createInterceptor } from '@conflux/sdk';

const interceptor = createInterceptor({
  target: 'all',       // 'http' | 'https' | 'all'
  captureBody: true,
  maxBodySize: 100000,
  onRequest: (context) => {
    console.log('→', context.request.method, context.request.url);
    // Optionally modify the request
    context.modifyRequest({
      headers: { ...context.request.headers, 'X-Custom': 'value' },
    });
  },
  onResponse: (context) => {
    console.log('←', context.response?.statusCode, context.request.url);
    // Optionally modify the response
    context.modifyResponse({
      statusCode: 200,
    });
  },
});

// Later, uninstall
interceptor.disable();
// Or: removeAllInterceptors();
```

### AI Agent Client

SDK for AI agents to register sessions and receive real-time exchange events:

```typescript
import { AgentClient } from '@conflux/sdk';

const agent = new AgentClient({
  proxyHost: '127.0.0.1',
  proxyPort: 9876,
  sessionId: 'my-agent-session',
  autoConnect: true,
});

agent.on('exchange', (exchange) => {
  console.log('Captured:', exchange.request.url);
  console.log('Tokens:', exchange.response?.tokenCount);
});

agent.on('breakpoint_hit', (data) => {
  console.log('Paused at exchange:', data.exchangeId);
});

agent.on('disconnect', () => {
  console.log('Disconnected from proxy');
});

agent.addBreakpoint({
  type: 'request',
  match: { urlPattern: '/v1/chat/completions' },
  enabled: true,
});

const har = await agent.exportHar();
agent.disconnect();
```

## API Reference

### `createProxyServer(options?)`

Create a full proxy server instance.

```typescript
interface ProxyServerOptions {
  port?: number;           // Default: 9876
  host?: string;           // Default: '127.0.0.1'
  logLevel?: 'silent' | 'info' | 'verbose' | 'debug';
  autoConfigureTrust?: boolean;  // Auto-set NODE_EXTRA_CA_CERTS
  wsPort?: number;         // Default: 9877
}
```

#### ProxyServer Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `Promise<void>` | Start the proxy |
| `stop()` | `Promise<void>` | Stop the proxy |
| `getExchanges()` | `CapturedExchange[]` | All captured exchanges |
| `getExchange(id)` | `CapturedExchange \| undefined` | Get by ID |
| `addBreakpoint(bp)` | `Breakpoint` | Add a breakpoint |
| `removeBreakpoint(id)` | `boolean` | Remove by ID |
| `listBreakpoints()` | `Breakpoint[]` | List all breakpoints |
| `resumeBreakpoint(id, mod?)` | `Promise<void>` | Resume a paused exchange |
| `clearExchanges()` | `void` | Clear all captures |
| `exportHar()` | `HarLog` | Export as HAR format |
| `getWss()` | `WebSocketServer` | WebSocket server instance |

### `createInterceptor(config)`

```typescript
interface InterceptorConfig {
  target: 'http' | 'https' | 'all';
  captureBody?: boolean;
  maxBodySize?: number;
  onRequest?: (context: InterceptContext) => void;
  onResponse?: (context: InterceptContext) => void;
}
```

Returns `{ enable, disable, isEnabled }`.

### `AgentClient`

```typescript
interface AgentClientConfig {
  proxyHost?: string;
  proxyPort?: number;
  wsPort?: number;
  sessionId?: string;       // Auto-generated if omitted
  autoConnect?: boolean;    // Default: true
}
```

#### AgentClient Events

- `exchange` — New request/response captured
- `breakpoint_hit` — Exchange hit a breakpoint
- `disconnect` — WebSocket disconnected
- `message` — Any other message from proxy

#### AgentClient Methods

- `connect()` / `disconnect()`
- `startProxyServer(port?)` / `stopProxyServer()`
- `getExchanges()`
- `addBreakpoint()` / `removeBreakpoint()`
- `exportHar()`
- `getSession()`
- `isConnectedToProxy()`

### Certificate Management

```typescript
import {
  loadOrCreateRootCA,
  generateCertForHost,
  getCAFingerprint,
  CA_CERT_PATH,
} from '@conflux/sdk';
```

CA cert stored at `~/.conflux-lens/ca.pem`.

### Type Exports

```typescript
import type {
  ProxyServerOptions,
  CapturedRequest,
  CapturedResponse,
  CapturedExchange,
  Breakpoint,
  InterceptContext,
  HarLog,
  AgentClientConfig,
} from '@conflux/sdk';
```

---

## HTTPS Interception

Set `autoConfigureTrust: true` when creating the proxy server to auto-configure Node.js:

```typescript
const proxy = createProxyServer({
  autoConfigureTrust: true,   // Sets NODE_EXTRA_CA_CERTS automatically
});
```

Or manually:
```bash
export NODE_EXTRA_CA_CERTS="$HOME/.conflux-lens/ca.pem"
```

CA certificate location: `~/.conflux-lens/ca.pem`

---

## Examples

See the `examples/` directory:

- `basic-proxy.js` — Simple proxy server
- `intercept-llm-calls.js` — Monitor OpenAI/Anthropic calls
- `har-export.js` — Capture and export HAR
- `breakpoint-demo.js` — Pause and inspect requests

---

## License

MIT — © 2026 The Conflux, LLC