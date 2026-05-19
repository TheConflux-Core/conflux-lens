import { createProxyServer, createInterceptor, AgentClient } from '@conflux/sdk';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as tls from 'tls';
import * as forge from 'node-forge';
import { URL } from 'url';
import { loadOrCreateRootCA, getCAFingerprint, CA_CERT_PATH } from './cert-manager';
import { TrustStore, checkTrust } from './utils/trust-store';

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '9876');
const WS_PORT = parseInt(process.env.WS_PORT || '9877');
const DASH_PORT = parseInt(process.env.DASH_PORT || '3000');

/**
 * =========================
 * SDK-Integrated Proxy Server
 * =========================
 * 
 * This main proxy server uses the @conflux/sdk for:
 * - ProxyServer (createProxyServer) for programmatic proxy management
 * - AgentClient for programmatic session control  
 * - Interceptor (createInterceptor) for HTTP/HTTPS module interception
 */

const proxyServer = createProxyServer({
  port: PROXY_PORT,
  host: '0.0.0.0',
  wsPort: WS_PORT,
  logLevel: 'info',
  autoConfigureTrust: false,
});

// Helper to broadcast messages to all dashboard WebSocket clients
function broadcastDashboardMessage(type: string, data: any) {
  const wss = proxyServer.getWss();
  const message = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if ((client as any).readyState === 1) {
      (client as any).send(message);
    }
  }
}

// Sync exchanges and breakpoint events to dashboard
proxyServer.getWss().on('connection', (client: any) => {
  for (const exchange of proxyServer.getExchanges()) {
    client.send(JSON.stringify({ type: 'exchange', data: exchange }));
  }
  client.send(JSON.stringify({ type: 'summary', data: { count: proxyServer.getExchanges().length } }));
});

// Override breakpoints management to emit dashboard events
const originalAddBreakpoint = proxyServer.addBreakpoint.bind(proxyServer);
proxyServer.addBreakpoint = function(bp) {
  const result = originalAddBreakpoint(bp);
  broadcastDashboardMessage('breakpointCreated', result);
  return result;
};

const originalRemoveBreakpoint = proxyServer.removeBreakpoint.bind(proxyServer);
proxyServer.removeBreakpoint = function(id) {
  const result = originalRemoveBreakpoint(id);
  if (result) {
    broadcastDashboardMessage('breakpointRemoved', { id });
  }
  return result;
};

/**
 * =========================
 * Legacy Dashboard Server
 * =========================
 * 
 * Serves static HTML/JS dashboard and provides REST API endpoints.
 * Works alongside the SDK proxy server on different ports.
 */

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const dashboardDir = path.join(__dirname, 'dashboard');

const dashboardServer = http.createServer((req, res) => {
  try {
    // API: List all exchanges
    if (req.url === '/api/exchanges' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(proxyServer.getExchanges()));
      return;
    }

    // API: Clear all exchanges
    if (req.url === '/api/exchanges' && req.method === 'DELETE') {
      proxyServer.clearExchanges();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: 0 }));
      return;
    }

    // API: Replay an exchange
    const replayMatch = req.url?.match(/^\/api\/exchanges\/([^\/]+)\/replay$/);
    if (replayMatch && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          // Make the replay request through the proxy
          const httpModule = require('http');
          const urlObj = new URL(data.url);
          const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: data.method || 'GET',
            headers: data.headers || {},
            ...(urlObj.protocol === 'https:' ? { rejectUnauthorized: false } : {})
          };
          const protocol = urlObj.protocol === 'https:' ? require('https') : httpModule;
          const replayReq = protocol.request(options, (replayRes: any) => {
            let resBody = '';
            replayRes.on('data', (chunk: any) => { resBody += chunk; });
            replayRes.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                replayId: 'replay_' + Date.now(),
                status: replayRes.statusCode,
                bodyLength: resBody.length 
              }));
            });
          });
          replayReq.on('error', (err: any) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          });
          if (data.body) {
            replayReq.write(data.body);
          }
          replayReq.end();
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body: ' + err.message }));
        }
      });
      return;
    }

    // API: Export HAR
    if (req.url === '/api/har' && req.method === 'GET') {
      const har = proxyServer.exportHar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(har));
      return;
    }

    // API: List breakpoints
    if (req.url === '/api/breakpoints' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(proxyServer.listBreakpoints()));
      return;
    }

    // API: Create breakpoint
    if (req.url === '/api/breakpoints' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const bp = proxyServer.addBreakpoint({
            type: data.type || 'both',
            match: data.match,
            enabled: data.enabled !== false,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bp));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
        }
      });
      return;
    }

    // API: Delete breakpoint
    const deleteMatch = req.url?.match(/^\/api\/breakpoints\/([^\/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(deleteMatch[1]);
      const result = proxyServer.removeBreakpoint(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: result }));
      return;
    }

    // API: Update breakpoint (toggle)
    const updateMatch = req.url?.match(/^\/api\/breakpoints\/([^\/]+)$/);
    if (updateMatch && req.method === 'PUT') {
      const id = decodeURIComponent(updateMatch[1]);
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const existing = proxyServer.listBreakpoints().find(b => b.id === id);
          if (!existing) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Breakpoint not found' }));
            return;
          }
          proxyServer.removeBreakpoint(id);
          const bp = proxyServer.addBreakpoint({
            type: data.type || existing.type,
            match: data.match || existing.match,
            enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bp));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
        }
      });
      return;
    }

    // API: Handle breakpoint actions (continue/modify/reject from dashboard)
    // This endpoint receives actions from the dashboard's breakpoint modal
    const bpTriggerMatch = req.url?.match(/^\/api\/breakpoints\/[^\/]+\/trigger$/);
    if (bpTriggerMatch && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          // Resume the breakpoint with optional modifications
          if (data.action === 'continue') {
            proxyServer.resumeBreakpoint(data.exchangeId);
          } else if (data.action === 'modify') {
            proxyServer.resumeBreakpoint(data.exchangeId, data.modification);
          } else if (data.action === 'reject') {
            // For reject, we could send an error response
            proxyServer.resumeBreakpoint(data.exchangeId, { _reject: true });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
        }
      });
      return;
    }

    // Serve static files
    let reqPath = req.url === '/' ? '/index.html' : req.url || '/index.html';
    if (reqPath.includes('..')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const filePath = path.join(dashboardDir, reqPath);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    if (!filePath.startsWith(dashboardDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end('Server Error');
  }
});

// ===== Startup Sequence =====
console.log('\n=== Conflux Lens Starting (SDK-Integrated) ===\n');

// Initialize CA certificates
loadOrCreateRootCA();

// Verify HTTPS interception capability
const caExists = fs.existsSync(CA_CERT_PATH);
if (caExists) {
  const fp = getCAFingerprint();
  console.log('\n\ud83d\udd10 HTTPS Interception: Ready');
  console.log(`   CA: ${CA_CERT_PATH}`);
  console.log(`   Fingerprint: ${fp}\n`);
}

// Start SDK proxy server
proxyServer.start().then(() => {
  console.log(`\n🚀 Proxy Server (SDK): http://localhost:${PROXY_PORT}`);
  console.log(`   WebSocket:    ws://localhost:${WS_PORT}`);
});

// Start dashboard
 dashboardServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${DASH_PORT} is already in use. Is another instance running?`);
    console.error(`   Try: lsof -i :${DASH_PORT} | grep LISTEN`);
    process.exit(1);
  }
  throw err;
});
 dashboardServer.listen(DASH_PORT, () => {
  console.log(`\n📊 Dashboard:   http://localhost:${DASH_PORT}`);
});

console.log('\n--- Configuration ---');
console.log(`   HTTP_PROXY=http://localhost:${PROXY_PORT}`);
console.log(`   HTTPS_PROXY=http://localhost:${PROXY_PORT}`);
console.log('\n   For HTTPS interception, configure agents to trust the CA.');
console.log('   See dashboard for live request inspection.\n');
console.log('=== Ready ===\n');

// Cleanup on shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  proxyServer.stop().then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  proxyServer.stop();
});

export default proxyServer;
export { proxyServer as getProxyServer };
