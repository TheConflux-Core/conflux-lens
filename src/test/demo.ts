/**
 * Demo Script for Conflux Lens - Phase 5 Integration Demo
 * 
 * This script demonstrates all features of the integrated proxy:
 * - SDK-based proxy server with WebSocket updates
 * - HTTP/HTTPS request interception and capture
 * - Breakpoint pause/resume with manual modifications
 * - HAR export
 * - AgentClient programmatic control
 */

import { createProxyServer, createInterceptor, AgentClient } from '@conflux/sdk';
import * as http from 'http';
import * as fs from 'fs';

console.log('\n' + '='.repeat(60));
console.log('  Conflux Lens - Phase 5 Integration Demo');
console.log('='.repeat(60) + '\n');

const DEMO_PORT = 19890;
const DEMO_WS_PORT = 19891;
const TARGET_PORT = 19900;

// Helper to delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo(): Promise<void> {
  // Step 0: Create a target HTTP server for testing
  console.log('Step 0: Setting up target HTTP server...');
  const targetServer = http.createServer((req, res) => {
    if (req.url === '/api/users') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ users: ['alice', 'bob', 'charlie'] }));
    } else if (req.url === '/api/data') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ echoed: body, length: body.length }));
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello from target server');
    }
  });

  await new Promise<void>(resolve => {
    targetServer.listen(TARGET_PORT, '127.0.0.1', () => {
      console.log(`  ✓ Target server running on http://127.0.0.1:${TARGET_PORT}`);
      resolve();
    });
  });

  await delay(500);

  // Step 1: Start the SDK proxy server
  console.log('\nStep 1: Starting SDK proxy server...');
  const proxy = createProxyServer({
    port: DEMO_PORT,
    wsPort: DEMO_WS_PORT,
    logLevel: 'info',
  });

  await proxy.start();
  console.log(`  ✓ Proxy server running on http://localhost:${DEMO_PORT}`);
  console.log(`  ✓ WebSocket server on port ${DEMO_WS_PORT}`);

  await delay(500);

  // Step 2: Make basic HTTP request through proxy
  console.log('\nStep 2: Making HTTP request through proxy...');
  const req1 = http.request({
    hostname: '127.0.0.1',
    port: DEMO_PORT,
    path: `http://127.0.0.1:${TARGET_PORT}/api/users`,
    method: 'GET',
  }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log(`  ✓ Response: ${res.statusCode} - ${body.substring(0, 60)}`);
    });
  });
  req1.on('error', (err) => console.log('  ✗ Error:', err.message));
  req1.end();

  await delay(1000);

  // Step 3: Make POST request with body
  console.log('\nStep 3: Making POST request with JSON body...');
  const postData = JSON.stringify({ action: 'create', item: 'test' });
  const req2 = http.request({
    hostname: '127.0.0.1',
    port: DEMO_PORT,
    path: `http://127.0.0.1:${TARGET_PORT}/api/data`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log(`  ✓ Response: ${res.statusCode} - ${body}`);
    });
  });
  req2.write(postData);
  req2.end();

  await delay(1000);

  // Step 4: Add a breakpoint and demonstrate pause/resume
  console.log('\nStep 4: Testing breakpoint pause/resume...');
  const bp = proxy.addBreakpoint({
    type: 'request',
    match: { method: 'POST', urlPattern: '/api/data' },
    enabled: true,
  });
  console.log(`  ✓ Breakpoint added: ${bp.id}`);
  console.log('    (Will pause POST requests to /api/data)');

  let breakpointHit = false;
  const bpWs = new (require('ws').WebSocket)(`ws://127.0.0.1:${DEMO_WS_PORT}`);
  bpWs.on('message', (data: any) => {
    const msg = JSON.parse(data);
    if (msg.type === 'breakpoint_hit' && !breakpointHit) {
      breakpointHit = true;
      console.log(`  ✓ Breakpoint hit! Exchange: ${msg.data.exchangeId}`);
      console.log('    Resuming breakpoint...');
      proxy.resumeBreakpoint(msg.data.exchangeId).then(() => {
        console.log(`  ✓ Breakpoint resumed`);
      });
    }
  });

  // Make request that hits breakpoint
  const req3 = http.request({
    hostname: '127.0.0.1',
    port: DEMO_PORT,
    path: `http://127.0.0.1:${TARGET_PORT}/api/data`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log(`  ✓ Response after breakpoint: ${res.statusCode}`);
    });
  });
  req3.write(JSON.stringify({ test: 'breakpoint' }));
  req3.end();

  await delay(2000);

  // Remove breakpoint
  proxy.removeBreakpoint(bp.id);
  console.log(`  ✓ Breakpoint removed: ${bp.id}`);
  bpWs.close();

  await delay(500);

  // Step 5: Export HAR
  console.log('\nStep 5: Exporting HAR file...');
  const har = proxy.exportHar();
  const harPath = `/tmp/demo-har-${Date.now()}.har`;
  fs.writeFileSync(harPath, JSON.stringify(har, null, 2));
  console.log(`  ✓ HAR exported to ${harPath}`);
  console.log(`  ✓ ${har.entries.length} entries captured`);

  // Step 6: AgentClient demonstration
  console.log('\nStep 6: Testing AgentClient...');
  const agentClient = new AgentClient({
    proxyPort: DEMO_PORT + 1,
    wsPort: DEMO_WS_PORT + 1,
    sessionId: 'demo-session-001',
    autoConnect: false,
  });

  const agentProxy = await agentClient.startProxyServer(DEMO_PORT + 1);
  console.log(`  ✓ Agent proxy started on port ${DEMO_PORT + 1}`);

  const req4 = http.request({
    hostname: '127.0.0.1',
    port: DEMO_PORT + 1,
    path: `http://127.0.0.1:${TARGET_PORT}/api/users`,
    method: 'GET',
  }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log(`  ✓ Agent proxy response: ${res.statusCode}`);
    });
  });
  req4.end();

  await delay(1000);

  const agentExchanges = await agentClient.getExchanges();
  console.log(`  ✓ Agent captured ${agentExchanges.length} exchanges`);

  const agentHar = await agentClient.exportHar();
  console.log(`  ✓ Agent HAR: ${agentHar.entries.length} entries`);

  await agentClient.stopProxyServer();
  console.log(`  ✓ Agent proxy stopped`);

  await delay(500);

  // Step 7: HTTP Interceptor demo
  console.log('\nStep 7: Testing HTTP interceptor...');
  let interceptedCount = 0;
  const interceptor = createInterceptor({
    target: 'http',
    captureBody: true,
    onRequest: (ctx) => {
      interceptedCount++;
    },
    onResponse: (ctx) => {
      // Response captured
    },
  });
  console.log('  ✓ Interceptor enabled');

  const req5 = http.request(`http://127.0.0.1:${TARGET_PORT}/test`, (res: any) => {
    res.on('data', () => {});
    res.on('end', () => {
      console.log(`  ✓ Interceptor captured ${interceptedCount} request`);
    });
  });
  req5.end();

  await delay(1000);
  interceptor.disable();
  console.log(`  ✓ Interceptor disabled`);

  // Cleanup
  await agentProxy.stop();
  await proxy.stop();
  targetServer.close();
  process.exit(0);
}

runDemo().catch((err) => {
  console.error('\n❌ Demo failed:', err);
  process.exit(1);
});
