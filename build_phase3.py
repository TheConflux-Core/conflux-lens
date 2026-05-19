import os, re

os.chdir('/mnt/c/Users/philm/Documents/ai-agent-proxy')

with open('src/index.ts.backup', 'r') as f:
    content = f.read()

# 1. Add URL import
content = content.replace(
    "import * as forge from 'node-forge';\n\nimport { handleHttpsConnect",
    "import * as forge from 'node-forge';\nimport { URL } from 'url';\n\nimport { handleHttpsConnect"
)

# 2. After exchanges map, add Phase 3 interfaces and maps
phase3_maps = '''
const breakpoints = new Map<string, Breakpoint>();
const queuedModifications = new Map<string, QueuedModification>();
const pendingRequests = new Map<string, {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  target: string;
  resolveModification: (mod?: { body?: string; headers?: Record<string, string | string[]>; method?: string; url?: string }) => void;
  startTime: number;
}>();
'''

content = content.replace(
    'const exchanges = new Map<string, CapturedExchange>();\nlet nextId = 1;\n',
    'const exchanges = new Map<string, CapturedExchange>();\n' + phase3_maps + '\nlet nextId = 1;\n'
)

# 3. After CapturedExchange interface, add interfaces
interfaces = '''

interface Breakpoint {
  id: string;
  type: 'request' | 'response' | 'both';
  match?: {
    method?: string;
    urlPattern?: string;
    statusCode?: number;
  };
  enabled: boolean;
  hitCount: number;
}

interface QueuedModification {
  exchangeId: string;
  type: 'request' | 'response';
  original: CapturedRequest | CapturedResponse;
  modified?: CapturedRequest | CapturedResponse;
  status: 'pending' | 'modified' | 'rejected';
}
'''

content = content.replace(
    'interface CapturedExchange {\n  id: string;\n  request: CapturedRequest;\n  response?: CapturedResponse;\n  isHttps?: boolean;\n}\n',
    'interface CapturedExchange {\n  id: string;\n  request: CapturedRequest;\n  response?: CapturedResponse;\n  isHttps?: boolean;\n}\n' + interfaces
)

# 4. Replace broadcastExport with broadcast
content = content.replace(
    'function broadcastExchange(exchange: CapturedExchange) {\n  const message = JSON.stringify({ type: \'exchange\', data: exchange });\n  for (const client of wss.clients) {\n    if ((client as any).readyState === 1) {\n      (client as any).send(message);\n    }\n  }\n}\n\n',
    'function broadcast(type: string, data: any) {\n  const message = JSON.stringify({ type, data });\n  for (const client of wss.clients) {\n    if ((client as any).readyState === 1) {\n      (client as any).send(message);\n    }\n  }\n}\n\nfunction broadcastExchange(exchange: CapturedExchange) {\n  broadcast("exchange", exchange);\n}\n\n'
)

# 5. Add all Phase 3 functions before handleHttpsConnect
phase3_funcs = '''
function normalizeHeadersObj(headers: Record<string, string | string[]>): Array<{ name: string; value: string }> {
  const result: Array<{ name: string; value: string }> = [];
  for (const [key, value] of Object.entries(headers)) {
    const val = Array.isArray(value) ? value.join(\', \') : value;
    result.push({ name: key, value: val || \'\' });
  }
  return result;
}

function matchesBreakpoint(bp: Breakpoint, exchange: CapturedExchange): boolean {
  if (!bp.match) return true;
  if (bp.match.method && exchange.request.method !== bp.match.method) return false;
  if (bp.match.urlPattern) {
    const pattern = bp.match.urlPattern;
    if (pattern.startsWith(\'/\') && pattern.endsWith(\'/\')) {
      const regex = new RegExp(pattern.slice(1, -1));
      if (!regex.test(exchange.request.url)) return false;
    } else if (!exchange.request.url.includes(pattern)) {
      return false;
    }
  }
  if (bp.match.statusCode && exchange.response?.statusCode !== bp.match.statusCode) return false;
  return true;
}

async function handleBreakpoint(
  exchange: CapturedExchange,
  type: \'request\' | \'response\',
  target: string,
  pendingReq?: any,
  pendingRes?: any
) {
  const matchingBps = Array.from(breakpoints.values()).filter(
    bp => bp.enabled && matchesBreakpoint(bp, exchange)
  );

  if (matchingBps.length === 0) {
    return { shouldPause: false };
  }

  console.log(`[Breakpoint] Paused ${type} exchange ${exchange.id}`);

  const modKey = `${exchange.id}-${type}`;
  queuedModifications.set(modKey, {
    exchangeId: exchange.id,
    type,
    original: type === \'request\' ? exchange.request : exchange.response,
    status: \'pending\'
  });

  broadcast(\'breakpoint\', {
    exchangeId: exchange.id,
    type,
    request: exchange.request,
    response: exchange.response,
    matchingBreakpoints: matchingBps.map(b => ({ id: b.id, type: b.type }))
  });

  return new Promise((resolve) => {
    if (pendingReq && pendingRes) {
      pendingRequests.set(exchange.id, {
        req: pendingReq,
        res: pendingRes,
        target,
        resolveModification: resolve,
        startTime: Date.now()
      });
    } else {
      resolve({ shouldPause: true });
    }
  });
}

async function replayExchange(exchange: CapturedExchange, modifications: any): Promise<any> {
  console.log(`[Replay] Exchange ${exchange.id}`);
  return new Promise((resolve, reject) => {
    const replayId = nextId++;
    const target = modifications.url || exchange.request.url;
    const method = modifications.method || exchange.request.method;

    let body = modifications.body || exchange.request.body;
    if (body && typeof body !== \'string\') body = JSON.stringify(body);

    const headers: Record<string, string> = {};
    Object.entries(exchange.request.headers).forEach(([k, v]) => {
      headers[k] = Array.isArray(v) ? v.join(\', \') : String(v || \'\');
    });
    if (modifications.headers) {
      Object.entries(modifications.headers).forEach(([k, v]: [string, any]) => {
        headers[k] = String(v);
      });
    }

    const startTime = Date.now();
    const proxyReq = http.request({
      hostname: target.includes(\'://\') ? new URL(target).hostname : exchange.request.host,
      port: target.includes(\'://\') ? (new URL(target).port || (target.startsWith(\'https\') ? 443 : 80)) : (exchange.request.protocol === \'HTTPS\' ? 443 : 80),
      path: target.includes(\'://\') ? (new URL(target).pathname + new URL(target).search) : exchange.request.path,
      method: method,
      headers: headers,
    }, (proxyRes) => {
      let body = \'\';
      proxyRes.on(\'data\', (chunk) => body += chunk);
      proxyRes.on(\'end\', () => {
        const duration = Date.now() - startTime;
        const replayExchange: CapturedExchange = {
          id: replayId.toString(),
          request: {
            id: replayId.toString(),
            timestamp: startTime,
            method: method,
            url: target,
            protocol: target.startsWith(\'https\') ? \'HTTPS\' : \'HTTP\',
            host: exchange.request.host,
            path: exchange.request.path,
            headers: headers,
            body: body || undefined,
          },
          response: {
            statusCode: proxyRes.statusCode || 0,
            statusMessage: proxyRes.statusMessage || \'\',
            headers: normalizeHeaders(proxyRes.headers),
            body: body,
            bodySize: Buffer.byteLength(body),
            duration,
            timestamp: Date.now(),
          },
          isHttps: target.startsWith(\'https\'),
        };
        exchanges.set(replayExchange.id, replayExchange);
        broadcastExchange(replayExchange);
        broadcast(\'replayComplete\', { originalId: exchange.id, replayId: replayExchange.id });
        resolve({ replayId: replayExchange.id, success: true });
      });
    });
    proxyReq.on(\'error\', (err) => reject(err));
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

function generateHar() {
  interface HarEntry {
    startedDateTime: string;
    time: number;
    request: any;
    response: any;
    cache: any;
    timings: any;
  }

  const entries: HarEntry[] = [];
  for (const exchange of exchanges.values()) {
    if (!exchange.response) continue;
    const ssl = exchange.isHttps ? exchange.response.duration * 0.3 : 0;
    const wait = exchange.response.duration * 0.5;
    const receive = exchange.response.duration * 0.2;
    entries.push({
      startedDateTime: new Date(exchange.request.timestamp).toISOString(),
      time: exchange.response.duration,
      request: {
        method: exchange.request.method,
        url: `${exchange.isHttps ? \'https\' : \'http\'}://${exchange.request.host}${exchange.request.path}`,
        httpVersion: exchange.isHttps ? \'HTTP/2.0\' : \'HTTP/1.1\',
        cookies: [],
        headers: normalizeHeadersObj(exchange.request.headers),
        queryString: [],
        headersSize: JSON.stringify(exchange.request.headers).length,
        bodySize: exchange.request.bodySize || 0,
        postData: exchange.request.body ? {
          mimeType: \'application/json\',
          text: exchange.request.body,
          params: []
        } : undefined
      },
      response: {
        status: exchange.response.statusCode,
        statusText: exchange.response.statusMessage,
        httpVersion: exchange.isHttps ? \'HTTP/2.0\' : \'HTTP/1.1\',
        cookies: [],
        headers: normalizeHeadersObj(exchange.response.headers),
        content: {
          size: exchange.response.bodySize || 0,
          mimeType: (exchange.response.headers[\'content-type\'] as string) || \'application/json\',
          text: exchange.response.body,
          encoding: exchange.response.body && exchange.response.body.length > 1000 ? \'base64\' : undefined
        },
        redirectURL: exchange.response.headers[\'location\'] as string || \'\',
        headersSize: JSON.stringify(exchange.response.headers).length,
        bodySize: exchange.response.bodySize || 0,
      },
      cache: { beforeRequest: {}, afterResponse: {} },
      timings: {
        blocked: 0,
        dns: exchange.isHttps ? Math.min(exchange.response.duration * 0.1, 100) : 0,
        connect: exchange.isHttps ? Math.min(exchange.response.duration * 0.1, 100) : 0,
        send: 0,
        wait,
        receive,
        ssl: exchange.isHttps ? ssl : undefined
      },
      serverIPAddress: undefined,
      connection: undefined
    });
  }
  return { log: { version: \'1.2\', creator: { name: \'AI Agent Proxy\', version: \'0.3.0\' }, entries } };
}

'''

target_func = 'export { handleHttpsConnect'
content = content.replace(target_func, phase3_funcs + target_func)

# 6. Replace request handler
old_req_handler = '''server.on('request', async (req, res) => {
  // Skip dashboard requests
  if (req.url === '/' || (req.url && (req.url.startsWith('/index.html') || req.url.startsWith('/api/') || req.url.endsWith('.js') || req.url.endsWith('.css') || req.url.endsWith('.html') || req.url.endsWith('/ws')))) {
    return;
  }

  const exchangeId = (nextId++).toString();
  const timestamp = Date.now();

  const { body: reqBody, size: reqBodySize } = await extractBody(req, req.headers['content-type'] as string);

  let targetUrl: URL;
  try {
    targetUrl = new URL(req.url || '/');
  } catch {
    try {
      const host = req.headers.host as string || '';
      targetUrl = new URL(`http://${host}${req.url}`);
    } catch {
      targetUrl = new URL(`http://dummy${req.url}`);
    }
  }

  const request: CapturedRequest = {
    id: exchangeId,
    timestamp,
    method: req.method || 'GET',
    url: req.url || '/',
    protocol: ((req.socket as any).encrypted ? 'HTTPS' : 'HTTP') as string,
    host: targetUrl.hostname,
    path: targetUrl.pathname + targetUrl.search,
    headers: normalizeHeaders(req.headers),
    body: reqBody,
    bodySize: reqBodySize,
  };

  const exchange: CapturedExchange = {
    id: exchangeId,
    request,
    isHttps: false,
  };
  exchanges.set(exchangeId, exchange);
  broadcastExchange(exchange);

  let target: string;
  if (req.url && req.url.startsWith('http')) {
    target = req.url;
  } else {
    const host = req.headers.host as string || '';
    target = `http://${host}${req.url}`;
  }

  (req as any)._exchangeId = exchangeId;
  (req as any)._startTime = timestamp;

  const proxyReq = proxy.web(req, res, { target, changeOrigin: true, ignorePath: false }, (err: any) => {
    if (!(res as any).headersSent) {
      (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
      (res as any).end('Bad Gateway: ' + err.message);
    }
  });

  proxy.once('proxyRes', async (proxyRes: http.IncomingMessage, req: http.IncomingMessage) => {
    const endTime = Date.now();
    const duration = endTime - timestamp;

    const { body: resBody, size: resBodySize } = await extractBody(proxyRes, proxyRes.headers['content-type'] as string);

    const response: CapturedResponse = {
      statusCode: proxyRes.statusCode || 0,
      statusMessage: proxyRes.statusMessage || '',
      headers: normalizeHeaders(proxyRes.headers),
      body: resBody,
      bodySize: resBodySize,
      duration,
      timestamp: endTime,
    };

    const updatedExchange = exchanges.get(exchangeId);
    if (updatedExchange) {
      updatedExchange.response = response;
      exchanges.set(exchangeId, updatedExchange);
      broadcastExchange(updatedExchange);
    }
  });
});

proxy.on('error', (err: any, req: any, res: any) => {
  if (res && !(res as any).headersSent) {
    (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
    (res as any).end('Bad Gateway: ' + err.message);
  }
});'''

new_req_handler = '''server.on('request', async (req, res) => {
  if (req.url === '/' || (req.url && (req.url.startsWith('/index.html') || req.url.startsWith('/api/') || req.url.endsWith('.js') || req.url.endsWith('.css') || req.url.endsWith('.html') || req.url.endsWith('/ws')))) {
    return;
  }

  const exchangeId = (nextId++).toString();
  const timestamp = Date.now();

  const { body: reqBody, size: reqBodySize } = await extractBody(req, req.headers['content-type'] as string);

  let targetUrl: URL;
  try {
    targetUrl = new URL(req.url || '/');
  } catch {
    try {
      const host = req.headers.host as string || '';
      targetUrl = new URL(`http://${host}${req.url}`);
    } catch {
      targetUrl = new URL(`http://dummy${req.url}`);
    }
  }

  const request: CapturedRequest = {
    id: exchangeId,
    timestamp,
    method: req.method || 'GET',
    url: req.url || '/',
    protocol: ((req.socket as any).encrypted ? 'HTTPS' : 'HTTP') as string,
    host: targetUrl.hostname,
    path: targetUrl.pathname + targetUrl.search,
    headers: normalizeHeaders(req.headers),
    body: reqBody,
    bodySize: reqBodySize,
  };

  const exchange: CapturedExchange = {
    id: exchangeId,
    request,
    isHttps: false,
  };
  exchanges.set(exchangeId, exchange);
  broadcastExchange(exchange);

  let target: string;
  if (req.url && req.url.startsWith('http')) {
    target = req.url;
  } else {
    const host = req.headers.host as string || '';
    target = `http://${host}${req.url}`;
  }

  (req as any)._exchangeId = exchangeId;
  (req as any)._startTime = timestamp;

  handleBreakpoint(exchange, 'request', target, req, res).then((bpResult: any) => {
    if (bpResult && bpResult.shouldPause !== false) {
      console.log('[Breakpoint] Request ' + exchangeId + ' paused');
      return;
    }
    forwardRequest(req, res, exchange, target, exchangeId, timestamp);
  });
});

function forwardRequest(req: http.IncomingMessage, res: http.ServerResponse, exchange: CapturedExchange, target: string, exchangeId: string, startTime: number) {
  const proxyReq = proxy.web(req, res, { target, changeOrigin: true, ignorePath: false }, (err: any) => {
    if (!(res as any).headersSent) {
      (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
      (res as any).end('Bad Gateway: ' + err.message);
    }
  });

  proxyReq.on('error', (err: any) => {
    if (!(res as any).headersSent) {
      (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
      (res as any).end('Proxy error: ' + err.message);
    }
  });

  proxy.once('proxyRes', async (proxyRes: http.IncomingMessage, proxyReq: http.IncomingMessage) => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const { body: resBody, size: resBodySize } = await extractBody(proxyRes, proxyRes.headers['content-type'] as string);

    const response: CapturedResponse = {
      statusCode: proxyRes.statusCode || 0,
      statusMessage: proxyRes.statusMessage || '',
      headers: normalizeHeaders(proxyRes.headers),
      body: resBody,
      bodySize: resBodySize,
      duration,
      timestamp: endTime,
    };

    const updatedExchange = exchanges.get(exchangeId);
    if (updatedExchange) {
      updatedExchange.response = response;
      exchanges.set(exchangeId, updatedExchange);
      broadcastExchange(updatedExchange);
    }

    handleBreakpoint(updatedExchange, 'response', target);
  });
}

proxy.on('error', (err: any, req: any, res: any) => {
  if (res && !(res as any).headersSent) {
    (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
    (res as any).end('Bad Gateway: ' + err.message);
  }
});'''

content = content.replace(old_req_handler, new_req_handler)

# 7. Replace dashboard handler with full API
old_dash = '''const dashboardServer = http.createServer((req, res) => {
  try {
    let reqPath = req.url === '/' ? '/index.html' : req.url || '/index.html';
    // Security: prevent directory traversal
    if (reqPath.includes('..')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const filePath = path.join(dashboardDir, reqPath);

    // Security: ensure filePath is within dashboardDir
    if (!filePath.startsWith(dashboardDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Handle API endpoints
    if (reqPath === '/api/exchanges') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.from(exchanges.values())));
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
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
});'''

new_dash = '''const dashboardServer = http.createServer((req, res) => {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const url = req.url || '/';

    // API endpoints
    if (url === '/api/exchanges' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.from(exchanges.values())));
      return;
    }
    if (url === '/api/exchanges' && method === 'DELETE') {
      const count = exchanges.size;
      exchanges.clear();
      broadcast('exchangesCleared', { count });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count, message: 'Cleared all exchanges' }));
      return;
    }
    const exchMatch = url.match(/^\/api\/exchanges\/([^/]+)$/);
    if (exchMatch && method === 'GET') {
      const exchange = exchanges.get(exchMatch[1]);
      if (exchange) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(exchange));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Exchange not found' }));
      }
      return;
    }
    const replayMatch = url.match(/^\/api\/exchanges\/([^/]+)\/replay$/);
    if (replayMatch && method === 'POST') {
      const exchange = exchanges.get(replayMatch[1]);
      if (!exchange) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Exchange not found' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let modBody = {};
        if (body) {
          try {
            modBody = JSON.parse(body);
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
          }
        }
        replayExchange(exchange, modBody).then(result => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      });
      return;
    }
    if (url === '/api/breakpoints' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.from(breakpoints.values())));
      return;
    }
    if (url === '/api/breakpoints' && method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const bp: Breakpoint = {
            id: (nextId++).toString(),
            type: data.type || 'both',
            match: data.match,
            enabled: data.enabled !== false,
            hitCount: 0
          };
          breakpoints.set(bp.id, bp);
          broadcast('breakpointCreated', bp);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bp));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }
    const bpMatch = url.match(/^\/api\/breakpoints\/([^/]+)$/);
    if (bpMatch && method === 'PUT') {
      const bp = breakpoints.get(bpMatch[1]);
      if (!bp) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Breakpoint not found' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.type !== undefined) bp.type = data.type;
          if (data.match !== undefined) bp.match = data.match;
          if (data.enabled !== undefined) bp.enabled = data.enabled;
          broadcast('breakpointUpdated', bp);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bp));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }
    if (bpMatch && method === 'DELETE') {
      const deleted = breakpoints.delete(bpMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted }));
      return;
    }
    const triggerMatch = url.match(/^\/api\/breakpoints\/([^/]+)\/trigger$/);
    if (triggerMatch && method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const modKey = `${data.exchangeId}-${data.type}`;
          const mod = queuedModifications.get(modKey);
          if (!mod) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Modification not found' }));
            return;
          }
          if (data.action === 'modify') {
            mod.modified = data.modification;
            mod.status = 'modified';
          } else if (data.action === 'continue') {
            mod.modified = mod.original;
            mod.status = 'modified';
          } else if (data.action === 'reject') {
            mod.status = 'rejected';
          }
          const pending = pendingRequests.get(data.exchangeId);
          if (pending) {
            pending.resolveModification(data.action === 'modify' ? data.modification : undefined);
            pendingRequests.delete(data.exchangeId);
          }
          broadcast('modificationApplied', mod);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mod));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }
    if (url === '/api/har' && method === 'GET') {
      const har = generateHar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(har, null, 2));
      return;
    }
    if (url === '/api/har/save' && method === 'POST') {
      let filename = `har-export-${Date.now()}.har`;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (body) {
          try {
            const data = JSON.parse(body);
            if (data.filename) filename = data.filename;
          } catch (e) {}
        }
        const har = generateHar();
        try {
          fs.writeFileSync(filename, JSON.stringify(har, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ filename, entries: har.log.entries.length }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (url === '/api/stats' && method === 'GET') {
      const total = exchanges.size;
      const withResponse = Array.from(exchanges.values()).filter(e => e.response).length;
      const https = Array.from(exchanges.values()).filter(e => e.isHttps).length;
      const pendingBps = Array.from(queuedModifications.values()).filter(m => m.status === 'pending').length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exchanges: total, withResponse, https,
        breakpoints: breakpoints.size,
        activeBreakpoints: Array.from(breakpoints.values()).filter(b => b.enabled).length,
        pendingModifications: pendingBps
      }));
      return;
    }

    let reqPath = url === '/' ? '/index.html' : url;
    if (reqPath.includes('..')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const filePath = path.join(dashboardDir, reqPath);
    if (!filePath.startsWith(dashboardDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
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
});'''

content = content.replace(old_dash, new_dash)

with open('src/index.ts', 'w') as f:
    f.write(content)

print('Phase 3 build complete')
