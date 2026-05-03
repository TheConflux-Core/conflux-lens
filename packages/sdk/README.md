# @ai-agent-proxy/sdk

TypeScript SDK for programmatic HTTP/HTTPS interception and AI agent traffic monitoring.

This library wraps proxy functionality into a consumable npm package for programmatic use by other tools and agents.

## Features

- **Programmatic Proxy Server**: Start/stop proxy servers programmatically
- **HTTP/HTTPS Interceptor**: Lightweight interceptor for Node.js http/https modules (no proxy config needed)
- **AI Agent Client**: SDK for AI agents to register and manage proxy sessions
- **Breakpoint Management**: Pause requests/responses at specific points
- **HAR Export**: Export captured traffic as HAR format
- **WebSocket Real-time Updates**: Get live traffic updates via WebSocket
- **HTTPS Interception**: Decrypt and inspect HTTPS traffic with auto-generated CA certificates

## Installation

```bash
npm install @ai-agent-proxy/sdk
```

Also install the peer dependency:
```bash
npm install ws
```

## Quick Start

### Basic Proxy Server

```typescript
import { createProxyServer } from '@ai-agent-proxy/sdk';

const proxy = createProxyServer({
  port: 9876,
  logLevel: 'info',
  autoConfigureTrust: true,
});

await proxy.start();

// Listen for captured exchanges
proxy.getWss().on('connection', (client) => {
  client.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'exchange') {
      const exchange = message.data;
      console.log(`${exchange.request.method} ${exchange.request.url}`);
      console.log(`Status: ${exchange.response?.statusCode}`);
    }
  });
});

// Add a breakpoint
proxy.addBreakpoint({
  type: 'request',
  match: { method: 'POST', urlPattern: '/api/chat' },
  enabled: true,
});

// Export HAR
const har = proxy.exportHar();
fs.writeFileSync('capture.har', JSON.stringify(har, null, 2));

// Stop the proxy
await proxy.stop();
```

### HTTP/HTTPS Interceptor (No Proxy Config)

Intercept HTTP/HTTPS requests made through Node.js http/https modules without configuring a proxy:

```typescript
import { createInterceptor } from '@ai-agent-proxy/sdk';

const interceptor = createInterceptor({
  target: 'all', // 'http' | 'https' | 'all'
  captureBody: true,
  maxBodySize: 100000,
  onRequest: (context) => {
    console.log('Request:', context.request.url);
    // Modify request before it goes out
    context.modifyRequest({
      headers: { ...context.request.headers, 'X-Custom': 'value' },
    });
  },
  onResponse: (context) => {
    console.log('Response:', context.response.statusCode);
    // Modify response before it returns
    context.modifyResponse({
      statusCode: 200,
    });
  },
});

// Later, disable the interceptor
interceptor.disable();
// Or remove all: removeAllInterceptors();
```

### AI Agent Client

SDK for AI agents to register and manage proxy sessions:

```typescript
import { AgentClient } from '@ai-agent-proxy/sdk';

const agent = new AgentClient({
  proxyHost: '127.0.0.1',
  proxyPort: 9876,
  sessionId: 'my-agent-session',
  autoConnect: true,
});

agent.on('exchange', (exchange) => {
  console.log('New exchange:', exchange.request.url);
});

agent.on('breakpoint_hit', (data) => {
  console.log('Breakpoint hit:', data);
});

agent.on('disconnect', () => {
  console.log('Disconnected from proxy');
});

// Add breakpoints
agent.addBreakpoint({
  type: 'request',
  match: { method: 'POST' },
  enabled: true,
});

// Export HAR
const har = await agent.exportHar();

agent.disconnect();
```

### Start Local Proxy for an Agent

```typescript
const agent = new AgentClient({ autoConnect: false });

// Start a dedicated proxy server for this agent
const proxy = await agent.startProxyServer(9876);

// Use the proxy normally
proxy.getWss().on('connection', (client) => {
  client.on('message', (data) => {
    // Handle exchanges
  });
});

await proxy.stop();
```

## API Reference

### ProxyServer

Main class for managing a proxy server with interception capabilities.

#### `new ProxyServer(options?)`

```typescript
interface ProxyServerOptions {
  port?: number;              // Default: 9876
  host?: string;              // Default: '127.0.0.1'
  logLevel?: ProxyLogLevel;  // 'silent' | 'info' | 'verbose' | 'debug'
  autoConfigureTrust?: boolean; // Auto-configure NODE_EXTRA_CA_CERTS
  wsPort?: number;            // Default: 9877
}
```

#### Methods

- `async start(): Promise<void>` - Start the proxy server
- `async stop(): Promise<void>` - Stop the proxy server
- `getExchanges(): CapturedExchange[]` - Get all captured exchanges
- `getExchange(id: string): CapturedExchange | undefined` - Get exchange by ID
- `addBreakpoint(breakpoint): Breakpoint` - Add a breakpoint
- `removeBreakpoint(id: string): boolean` - Remove a breakpoint
- `listBreakpoints(): Breakpoint[]` - List all breakpoints
- `resumeBreakpoint(exchangeId, modifications?): Promise<void>` - Resume a paused exchange
- `clearExchanges(): void` - Clear all exchanges
- `exportHar(): HarLog` - Export exchanges as HAR

#### Breakpoint

```typescript
interface Breakpoint {
  type: 'request' | 'response' | 'both';
  match?: {
    method?: string | RegExp;
    urlPattern?: string | RegExp;
    statusCode?: number;
  };
  enabled: boolean;
}
```

### createProxyServer()

Convenience function to create a ProxyServer instance:

```typescript
import { createProxyServer } from '@ai-agent-proxy/sdk';

const proxy = createProxyServer({
  port: 9876,
  logLevel: 'info',
});
```

### createInterceptor()

Create a lightweight HTTP/HTTPS interceptor for Node.js http/https modules:

```typescript
const interceptor = createInterceptor({
  target: 'all',
  captureBody: true,
  maxBodySize: 100000,
  onRequest: (context) => { ... },
  onResponse: (context) => { ... },
});

interceptor.enable();
interceptor.disable();
```

```typescript
interface InterceptorConfig {
  target: 'http' | 'https' | 'all';
  captureBody?: boolean;
  maxBodySize?: number;
  onRequest?: (context: InterceptContext) => void;
  onResponse?: (context: InterceptContext) => void;
}
```

### removeAllInterceptors()

Remove all active interceptors and uninstall patching:

```typescript
import { removeAllInterceptors } from '@ai-agent-proxy/sdk';

removeAllInterceptors();
```

### getInterceptorCount()

Get the number of active interceptors:

```typescript
import { getInterceptorCount } from '@ai-agent-proxy/sdk';

console.log('Active interceptors:', getInterceptorCount());
```

### AgentClient

SDK for AI agents to register and manage proxy sessions.

#### `new AgentClient(config?)`

```typescript
interface AgentClientConfig {
  proxyHost?: string;      // Default: '127.0.0.1'
  proxyPort?: number;      // Default: 9876
  wsPort?: number;         // Default: 9877
  apiKey?: string;
  sessionId?: string;      // Auto-generated if not provided
  autoConnect?: boolean;   // Default: true
}
```

#### Methods

- `async connect(): Promise<void>` - Connect to proxy
- `disconnect(): void` - Disconnect from proxy
- `async startProxyServer(port?): Promise<ProxyServer>` - Start local proxy
- `async stopProxyServer(): Promise<void>` - Stop local proxy
- `on(event, handler): void` - Add event listener
- `off(event, handler): void` - Remove event listener
- `async getExchanges(): Promise<CapturedExchange[]>` - Get exchanges
- `addBreakpoint(breakpoint): Breakpoint | undefined` - Add breakpoint
- `removeBreakpoint(id): boolean` - Remove breakpoint
- `async exportHar(): Promise<HarLog>` - Export HAR
- `getSession(): AgentSession | null` - Get session info
- `isConnectedToProxy(): boolean` - Check connection status

#### Events

- `exchange` - Fired when a new exchange is captured
- `breakpoint_hit` - Fired when a breakpoint is hit
- `disconnect` - Fired when disconnected
- `message` - Fired for any other message

```typescript
agent.on('exchange', (exchange) => {
  console.log('New exchange:', exchange.request.url);
});
```

### Certificate Management

```typescript
import {
  loadOrCreateRootCA,
  generateCertForHost,
  getCAFingerprint,
  CA_CERT_PATH,
} from '@ai-agent-proxy/sdk';

// Load or create root CA
const { cert, key } = loadOrCreateRootCA();

// Generate certificate for a host
const hostCert = generateCertForHost('example.com');

// Get CA fingerprint
const fp = getCAFingerprint();
```

### Types

All types are exported:

```typescript
import type {
  ProxyServerOptions,
  CapturedRequest,
  CapturedResponse,
  CapturedExchange,
  Breakpoint,
  HarLog,
  // ... more
} from '@ai-agent-proxy/sdk';
```

See `types.d.ts` for the complete type definitions.

## HTTPS Interception

To intercept HTTPS traffic, the proxy uses a man-in-the-middle (MITM) approach with a root CA certificate.

### Setup

```typescript
const proxy = createProxyServer({
  autoConfigureTrust: true, // Auto-configures NODE_EXTRA_CA_CERTS
});
```

Or manually:

```bash
export NODE_EXTRA_CA_CERTS="$HOME/.ai-agent-proxy/ca.pem"
```

The CA certificate is auto-generated on first run at:
- `~/.ai-agent-proxy/ca.pem` (certificate)
- `~/.ai-agent-proxy/ca-key.pem` (private key)

### Trust the CA

For HTTPS interception to work, the CA must be trusted by your applications:

**Node.js**:
```bash
export NODE_EXTRA_CA_CERTS="$HOME/.ai-agent-proxy/ca.pem"
```

**Chrome/Firefox**: Import `ca.pem` into trusted root certificates.

**cURL**: `curl --cacert ~/.ai-agent-proxy/ca.pem https://example.com`

## Examples

See the `examples/` directory:

- `basic-proxy.js` - Basic proxy server example
- `intercept-llm-calls.js` - Monitor LLM API calls
- `har-export.js` - Export traffic as HAR
- `breakpoint-demo.js` - Breakpoint usage demo
- `test-basic.js` - Simple SDK test

## Architecture

```

   Your Application    

           
           

   @ai-agent-proxy/sdk                 
   
   ProxyServer      WebSocket    
   - HTTP/HTTPS                    Clients
   - Breakpoints                    Dashboard
   - HAR Export                   
   
           
           

   Target Server     

```

## License

MIT
