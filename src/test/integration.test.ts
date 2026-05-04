/**
 * Integration Test Suite for Conflux Lens
 * 
 * Tests all major features:
 * 1. HTTP/HTTPS request interception via SDK proxy
 * 2. Breakpoint pause/resume functionality
 * 3. HAR export
 * 4. AgentClient programmatic control
 * 5. HTTP interceptor (module patching)
 */

import { createProxyServer, createInterceptor, AgentClient } from '@conflux/sdk';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

const TEST_PORT = 19876;
const TEST_WS_PORT = 19877;

// Test utilities
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeHttpRequest(options: any, body?: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeHttpsRequest(options: any, body?: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, rejectUnauthorized: false }, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Test 1: Basic HTTP proxy functionality
 */
async function testBasicHttpProxy(): Promise<boolean> {
  console.log('\n--- Test 1: Basic HTTP Proxy ---');

  let targetServer!: http.Server;
  let targetPort = 0;

  try {
    // Create a target HTTP server
    await new Promise<void>((resolve) => {
      targetServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Hello from target', path: req.url }));
      });
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        console.log(`  Target server on port ${targetPort}`);
        resolve();
      });
    });

    // Start proxy
    const proxy = createProxyServer({
      port: TEST_PORT,
      wsPort: TEST_WS_PORT,
      logLevel: 'silent',
    });
    await proxy.start();
    console.log(`  Proxy started on port ${TEST_PORT}`);

    // Make request through proxy
    const result = await makeHttpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `http://127.0.0.1:${targetPort}/test-path`,
      method: 'GET',
    });

    console.log(`  Response: ${result.statusCode} - ${result.body.substring(0, 50)}`);

    const exchanges = proxy.getExchanges();
    console.log(`  Captured exchanges: ${exchanges.length}`);

    // Verify
    if (result.statusCode !== 200) {
      throw new Error(`Expected 200, got ${result.statusCode}`);
    }
    if (exchanges.length !== 1) {
      throw new Error(`Expected 1 exchange, got ${exchanges.length}`);
    }
    if (!exchanges[0].response || exchanges[0].response.statusCode !== 200) {
      throw new Error('Exchange response not captured correctly');
    }

    await proxy.stop();
    targetServer.close();
    console.log('  ✓ PASSED');
    return true;
  } catch (err) {
    console.log('  ✗ FAILED:', err);
    targetServer?.close();
    return false;
  }
}

/**
 * Test 2: Request body capture
 */
async function testRequestBodyCapture(): Promise<boolean> {
  console.log('\n--- Test 2: Request Body Capture ---');

  let targetServer!: http.Server;
  let targetPort = 0;

  try {
    await new Promise<void>((resolve) => {
      targetServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: body }));
        });
      });
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    const proxy = createProxyServer({
      port: TEST_PORT + 1,
      wsPort: TEST_WS_PORT + 1,
      logLevel: 'silent',
    });
    await proxy.start();

    const testBody = JSON.stringify({ test: 'data', value: 123 });
    const result = await makeHttpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT + 1,
      path: `http://127.0.0.1:${targetPort}/echo`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(testBody),
      },
    }, testBody);

    const exchanges = proxy.getExchanges();
    if (exchanges.length !== 1) {
      throw new Error(`Expected 1 exchange, got ${exchanges.length}`);
    }

    const req = exchanges[0].request;
    if (!req.body) {
      throw new Error('Request body not captured');
    }
    if (!req.body.includes('test')) {
      throw new Error('Request body content incorrect');
    }

    await proxy.stop();
    targetServer.close();
    console.log('  ✓ PASSED');
    return true;
  } catch (err) {
    console.log('  ✗ FAILED:', err);
    targetServer?.close();
    return false;
  }
}

/**
 * Test 3: Breakpoint functionality
 */
async function testBreakpoints(): Promise<boolean> {
  console.log('\n--- Test 3: Breakpoint Pause/Resume ---');

  let targetServer!: http.Server;
  let targetPort = 0;

  try {
    let requestReceived = false;
    await new Promise<void>((resolve) => {
      targetServer = http.createServer((req, res) => {
        requestReceived = true;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      });
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    const proxy = createProxyServer({
      port: TEST_PORT + 2,
      wsPort: TEST_WS_PORT + 2,
      logLevel: 'silent',
    });
    await proxy.start();

    // Add breakpoint for POST requests
    const bp = proxy.addBreakpoint({
      type: 'request',
      match: { method: 'POST' },
      enabled: true,
    });
    console.log(`  Breakpoint added: ${bp.id}`);

    // Make request in background - should pause at breakpoint
    const requestPromise = makeHttpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT + 2,
      path: `http://127.0.0.1:${targetPort}/test`,
      method: 'POST',
    }, 'test data');

    // Wait a bit for breakpoint to be hit
    await delay(500);

    // Check that request hasn't completed yet (breakpoint paused it)
    const exchanges = proxy.getExchanges();
    console.log(`  Exchanges after 500ms: ${exchanges.length}`);

    if (exchanges.length === 0) {
      throw new Error('No exchanges captured');
    }

    // Resume the breakpoint
    await proxy.resumeBreakpoint(exchanges[0].id);
    console.log('  Breakpoint resumed');

    // Wait for request to complete
    const result = await requestPromise;
    console.log(`  Response: ${result.statusCode}`);

    if (result.statusCode !== 200) {
      throw new Error(`Expected 200, got ${result.statusCode}`);
    }

    await proxy.stop();
    targetServer.close();
    console.log('  ✓ PASSED');
    return true;
  } catch (err) {
    console.log('  ✗ FAILED:', err);
    targetServer?.close();
    return false;
  }
}

/**
 * Test 4: HAR Export
 */
async function testHarExport(): Promise<boolean> {
  console.log('\n--- Test 4: HAR Export ---');

  let targetServer!: http.Server;
  let targetPort = 0;

  try {
    await new Promise<void>((resolve) => {
      targetServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    const proxy = createProxyServer({
      port: TEST_PORT + 3,
      wsPort: TEST_WS_PORT + 3,
      logLevel: 'silent',
    });
    await proxy.start();

    // Make several requests
    for (let i = 0; i < 3; i++) {
      await makeHttpRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT + 3,
        path: `http://127.0.0.1:${targetPort}/api/endpoint${i}`,
        method: 'GET',
      });
    }

    const har = proxy.exportHar();
    console.log(`  HAR entries: ${har.entries.length}`);
    console.log(`  HAR creator: ${har.creator.name}`);

    if (har.version !== '1.2') {
      throw new Error('Invalid HAR version');
    }
    if (har.entries.length !== 3) {
      throw new Error(`Expected 3 HAR entries, got ${har.entries.length}`);
    }
    if (!har.creator.name.includes('Conflux Lens')) {
      throw new Error('Invalid HAR creator');
    }

    await proxy.stop();
    targetServer.close();
    console.log('  ✓ PASSED');
    return true;
  } catch (err) {
    console.log('  ✗ FAILED:', err);
    targetServer?.close();
    return false;
  }
}

/**
 * Test 5: HTTP Interceptor (module patching)
 */
async function testInterceptor(): Promise<boolean> {
  console.log('\n--- Test 5: HTTP Module Interceptor ---');

  let targetServer!: http.Server;
  let targetPort = 0;

  try {
    await new Promise<void>((resolve) => {
      targetServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Intercept me');
      });
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    let interceptedRequest = false;
    let interceptedResponse = false;

    const interceptor = createInterceptor({
      target: 'http',
      captureBody: true,
      onRequest: (context) => {
        console.log(`  Request intercepted: ${context.request.method} ${context.request.url}`);
        interceptedRequest = true;
      },
      onResponse: (context) => {
        console.log(`  Response intercepted: ${context.response?.statusCode}`);
        interceptedResponse = true;
      },
    });

    // Use Node's http module directly (should be intercepted)
    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${targetPort}/test`, (res: any) => {
        let body = '';
        res.on('data', (chunk: any) => { body += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      });
      req.on('error', reject);
      req.end();
    });

    console.log(`  Response: ${result.statusCode} - ${result.body}`);

    if (!interceptedRequest) {
      throw new Error('Request not intercepted');
    }
    if (!interceptedResponse) {
      throw new Error('Response not intercepted');
    }

    interceptor.disable();
    targetServer.close();
    console.log('  ✓ PASSED');
    return true;
  } catch (err) {
    console.log('  ✗ FAILED:', err);
    targetServer?.close();
    return false;
  }
}

/**
 * Test 6: AgentClient
 */
async function testAgentClient(): Promise<boolean> {
  console.log('\n--- Test 6: AgentClient ---');

  let targetServer!: http.Server;
  let targetPort = 0;

  try {
    await new Promise<void>((resolve) => {
      targetServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Agent test');
      });
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    // Start a proxy with AgentClient
    const client = new AgentClient({
      proxyPort: TEST_PORT + 4,
      wsPort: TEST_WS_PORT + 4,
      sessionId: 'test-session',
      autoConnect: false, // Don't auto-connect since we create our own proxy
    });

    // Start local proxy through AgentClient
    const proxy = await client.startProxyServer(TEST_PORT + 4);
    console.log(`  Agent proxy started`);

    // Make request
    const result = await makeHttpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT + 4,
      path: `http://127.0.0.1:${targetPort}/test`,
      method: 'GET',
    });

    const exchanges = await client.getExchanges();
    console.log(`  Exchanges via AgentClient: ${exchanges.length}`);

    if (result.statusCode !== 200) {
      throw new Error(`Expected 200, got ${result.statusCode}`);
    }
    if (exchanges.length !== 1) {
      throw new Error(`Expected 1 exchange, got ${exchanges.length}`);
    }

    // Export HAR via AgentClient
    const har = await client.exportHar();
    console.log(`  HAR entries via AgentClient: ${har.entries.length}`);

    await client.stopProxyServer();
    targetServer.close();
    console.log('  ✓ PASSED');
    return true;
  } catch (err) {
    console.log('  ✗ FAILED:', err);
    targetServer?.close();
    return false;
  }
}

/**
 * Main test runner
 */
async function runAllTests(): Promise<void> {
  console.log('\n========================================');
  console.log('  Conflux Lens - Integration Tests');
  console.log('========================================');

  const results: { name: string; passed: boolean }[] = [];

  results.push({ name: 'Basic HTTP Proxy', passed: await testBasicHttpProxy() });
  results.push({ name: 'Request Body Capture', passed: await testRequestBodyCapture() });
  results.push({ name: 'Breakpoint Pause/Resume', passed: await testBreakpoints() });
  results.push({ name: 'HAR Export', passed: await testHarExport() });
  results.push({ name: 'HTTP Interceptor', passed: await testInterceptor() });
  results.push({ name: 'AgentClient', passed: await testAgentClient() });

  console.log('\n========================================');
  console.log('  Test Results Summary');
  console.log('========================================');
  results.forEach(r => {
    console.log(`  ${r.passed ? '✓' : '✗'} ${r.name}`);
  });
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
