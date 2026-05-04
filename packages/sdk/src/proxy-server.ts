/**
 * Programmatic Proxy Server
 * Creates and manages an HTTP/HTTPS proxy server with interception capabilities
 */

import http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import * as url from 'url';
import { WebSocketServer } from 'ws';
import { createProxyServer as createProxyServerOrig } from 'http-proxy';
import * as forge from 'node-forge';
import {
  loadOrCreateRootCA,
  generateCertForHost,
  clearCertCache,
  CA_CERT_PATH,
} from './cert-manager';
import {
  ProxyServerOptions,
  ProxyLogLevel,
  CapturedRequest,
  CapturedResponse,
  CapturedExchange,
  Breakpoint,
} from './types';

export class ProxyServer {
  private proxyServer: http.Server;
  private wss: WebSocketServer;
  private httpProxy: any;
  private options: ProxyServerOptions;
  private exchanges = new Map<string, CapturedExchange>();
  private breakpoints = new Map<string, Breakpoint>();
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; data: any }>();
  private nextId = 1;
  private tlsServers = new Map<string, net.Server>();

  constructor(options: ProxyServerOptions = {}) {
    this.options = {
      port: 9876,
      host: '127.0.0.1',
      logLevel: 'info',
      autoConfigureTrust: false,
      wsPort: 9877,
      ...options,
    };

    this.httpProxy = createProxyServerOrig({});
    this.proxyServer = http.createServer();
    this.wss = new WebSocketServer({ port: this.options.wsPort });

    this.setupWebSocketHandlers();
    this.setupProxyHandlers();
    this.setupHttpHandlers();
  }

  private setupWebSocketHandlers(): void {
    this.wss.on('connection', (client: any) => {
      for (const exchange of this.exchanges.values()) {
        client.send(JSON.stringify({ type: 'exchange', data: exchange }));
      }
      client.send(JSON.stringify({ type: 'summary', data: { count: this.exchanges.size } }));
    });
  }

  private setupProxyHandlers(): void {
    this.httpProxy.on('proxyRes', async (proxyRes: http.IncomingMessage, req: http.IncomingMessage) => {
      const exchangeId = (req as any)._exchangeId as string;
      const startTime = (req as any)._startTime as number;
      const duration = Date.now() - startTime;

      const response: CapturedResponse = {
        statusCode: proxyRes.statusCode || 0,
        statusMessage: proxyRes.statusMessage || '',
        headers: this.normalizeHeaders(proxyRes.headers),
        body: undefined,
        bodySize: 0,
        duration,
        timestamp: Date.now(),
      };

      if (proxyRes.headers['content-type']?.includes('application/json') ||
          proxyRes.headers['content-type']?.includes('text/')) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          if (chunks.length > 0) {
            const combined = Buffer.concat(chunks);
            response.body = combined.length > 50000
              ? combined.toString('utf8').substring(0, 50000) + '... [truncated]'
              : combined.toString('utf8');
            response.bodySize = combined.length;
          }
          this.updateExchange(exchangeId, { response });
        });
      }
    });

    this.httpProxy.on('error', (err: Error, req: any, res: any) => {
      if (res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway: ' + err.message);
      }
    });
  }

  private setupHttpHandlers(): void {
    this.proxyServer.on('connect', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      this.handleHttpsConnect(req, socket, head);
    });

    this.proxyServer.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.url?.startsWith('/internal')) {
        return;
      }

      const exchangeId = (this.nextId++).toString();
      const timestamp = Date.now();

      const request: CapturedRequest = {
        id: exchangeId,
        timestamp,
        method: req.method || 'GET',
        url: req.url || '/',
        protocol: (req.socket as any).encrypted ? 'HTTPS' : 'HTTP',
        host: req.headers.host as string || '',
        path: url.parse(req.url || '').pathname || '/',
        headers: this.normalizeHeaders(req.headers),
        body: undefined,
        bodySize: 0,
      };

      const exchange: CapturedExchange = {
        id: exchangeId,
        request,
        isHttps: false,
      };

      if (req.headers['content-type']?.includes('application/json') ||
          req.headers['content-type']?.includes('text/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          if (chunks.length > 0) {
            const combined = Buffer.concat(chunks);
            request.body = combined.length > 50000
              ? combined.toString('utf8').substring(0, 50000) + '... [truncated]'
              : combined.toString('utf8');
            request.bodySize = combined.length;
          }
        });
      }

      (req as any)._exchangeId = exchangeId;
      (req as any)._startTime = timestamp;

      this.exchanges.set(exchangeId, exchange);
      this.broadcastExchange(exchange);

      if (this.checkBreakpoint('request', exchange)) {
        await this.waitForBreakpoint(exchangeId, 'request');
      }

      let target = req.url || '';
      if (!target.startsWith('http')) {
        target = `http://${req.headers.host}${req.url}`;
      }

      this.httpProxy.web(req, res, { target, changeOrigin: true, ignorePath: false });
    });
  }

  private handleHttpsConnect(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
    const host = req.url;
    if (!host) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.end();
      return;
    }

    const [hostname, portStr] = host.split(':');
    const port = parseInt(portStr, 10) || 443;

    const exchangeId = (this.nextId++).toString();
    const exchange: CapturedExchange = {
      id: exchangeId,
      request: {
        id: exchangeId,
        timestamp: Date.now(),
        method: 'CONNECT',
        url: `https://${host}`,
        protocol: 'HTTPS',
        host: hostname,
        path: '/',
        headers: this.normalizeHeaders(req.headers),
      },
      isHttps: true,
    };

    this.exchanges.set(exchangeId, exchange);
    this.broadcastExchange(exchange);

    // CRITICAL: This is where MITM HTTPS interception happens.
    // After 200 Connection Established, the client will start a TLS handshake
    // with the proxy (thinking it's the real server).
    // We need to:
    // 1. Generate a cert for the target hostname
    // 2. Terminate the client's TLS using that cert (decrypt)
    // 3. Connect to the real upstream server via TLS
    // 4. Pipe decrypted data between client and upstream

    socket.write('HTTP/1.1 200 Connection Established\r\n');
    socket.write('Proxy-Agent: Conflux Lens\r\n');
    socket.write('\r\n');

    // Generate certificate for this hostname (signed by our CA)
    const { cert, key } = generateCertForHost(hostname);

    // Create TLS server to handle client's TLS handshake with our generated cert
    // This is the MITM part - we pretend to be the target server
    const tlsServer = tls.createServer({
      key,
      cert,
      requestCert: false,
      rejectUnauthorized: false,
    }, (clientTlsSocket: tls.TLSSocket) => {
      // Client TLS handshake complete - we now have decrypted data from client
      
      // Connect to the real upstream server
      const upstreamTls = tls.connect({
        host: hostname,
        port,
        rejectUnauthorized: false,
      }, () => {
        // Upstream TLS connected - now we can pipe decrypted data
        
        // Pipe client -> upstream (decrypted by clientTlsSocket, re-encrypted by upstreamTls)
        clientTlsSocket.pipe(upstreamTls);
        
        // Pipe upstream -> client (decrypted by upstreamTls, re-encrypted by clientTlsSocket)
        upstreamTls.pipe(clientTlsSocket);
        
        // Log request data for capture/exchange
        clientTlsSocket.on('data', (chunk: Buffer) => {
          try {
            const data = chunk.toString('utf8');
            // Check if this looks like HTTP request
            if (data.startsWith('GET ') || data.startsWith('POST ') || data.startsWith('PUT ') || 
                data.startsWith('DELETE ') || data.startsWith('PATCH ') || data.startsWith('HEAD ')) {
              // Update exchange with request data
              const capturedRequest: CapturedRequest = {
                ...exchange.request,
                body: data.length > 50000 ? data.substring(0, 50000) + '... [truncated]' : data,
                bodySize: data.length,
              };
              exchange.request = capturedRequest;
              this.updateExchange(exchangeId, { request: capturedRequest });
            }
          } catch (e) {
            // Ignore parse errors
          }
        });
        
        // Log response data
        upstreamTls.on('data', (chunk: Buffer) => {
          try {
            const data = chunk.toString('utf8');
            if (data.startsWith('HTTP/')) {
              const firstLine = data.split('\r\n')[0];
              const match = firstLine.match(/HTTP\/\d\.\d (\d+) (.*)/);
              if (match) {
                const statusCode = parseInt(match[1], 10);
                const response: CapturedResponse = {
                  statusCode,
                  statusMessage: match[2],
                  headers: {},
                  duration: Date.now() - exchange.request.timestamp,
                  timestamp: Date.now(),
                  body: data.length > 50000 ? data.substring(0, 50000) + '... [truncated]' : data,
                  bodySize: data.length,
                };
                this.updateExchange(exchangeId, { response });
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        });
        
        this.log('info', `HTTPS MITM established: ${hostname}:${port}`);
      });
      
      upstreamTls.on('error', (err: Error) => {
        this.log('verbose', `Upstream TLS error: ${err.message}`);
        clientTlsSocket.end();
      });
      
      clientTlsSocket.on('error', (err: Error) => {
        this.log('verbose', `Client TLS error: ${err.message}`);
        upstreamTls.end();
      });
    });
    
    // Handle the TLS server errors
    tlsServer.on('error', (err: Error) => {
      this.log('verbose', `TLS server error: ${err.message}`);
      socket.end();
    });
    
    // Now we need to feed the client socket's data into the TLS server
    // The client will start sending TLS ClientHello after receiving 200
    // We pipe the raw socket data to the TLS server
    
    // Create a connection to the TLS server via a pipe
    // The TLS server is listening on localhost, we connect to it and pipe the client socket
    
    tlsServer.listen(0, '127.0.0.1', () => {
      const mitmPort = (tlsServer.address() as net.AddressInfo).port;
      
      // Connect to our TLS server and pipe the client socket to it
      const pipeSocket = net.connect(mitmPort, '127.0.0.1', () => {
        // Once connected to our TLS server, pipe the client socket to this connection
        socket.pipe(pipeSocket);
        pipeSocket.pipe(socket);
        
        // If there was initial head data, write it
        if (head && head.length > 0) {
          pipeSocket.write(head);
        }
      });
      
      pipeSocket.on('error', () => {
        socket.end();
      });
      
      this.log('debug', `MITM proxying ${hostname}:${port} via localhost:${mitmPort}`);
    });
    
    this.tlsServers.set(hostname, tlsServer);
    
    socket.on('error', () => {
      tlsServer.close();
      this.tlsServers.delete(hostname);
    });
  }

  getWss(): WebSocketServer {
    return this.wss;
  }

  private normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = value as string | string[];
    }
    return result;
  }

  private broadcastExchange(exchange: CapturedExchange): void {
    const message = JSON.stringify({ type: 'exchange', data: exchange });
    for (const client of this.wss.clients) {
      if ((client as any).readyState === 1) {
        (client as any).send(message);
      }
    }
  }

  private updateExchange(id: string, update: Partial<CapturedExchange>): void {
    const exchange = this.exchanges.get(id);
    if (exchange) {
      Object.assign(exchange, update);
      this.exchanges.set(id, exchange);
      this.broadcastExchange(exchange);
    }
  }

  private checkBreakpoint(type: 'request' | 'response', exchange: CapturedExchange): boolean {
    for (const bp of this.breakpoints.values()) {
      if (!bp.enabled) continue;
      if (bp.type !== type && bp.type !== 'both') continue;

      if (bp.match) {
        if (bp.match.method && bp.match.method !== exchange.request.method) continue;
        if (bp.match.urlPattern) {
          const pattern = bp.match.urlPattern instanceof RegExp
            ? bp.match.urlPattern
            : new RegExp(bp.match.urlPattern as string);
          if (!pattern.test(exchange.request.url)) continue;
        }
      }

      return true;
    }
    return false;
  }

  private async waitForBreakpoint(exchangeId: string, type: 'request' | 'response'): Promise<void> {
    return new Promise((resolve) => {
      this.pendingRequests.set(exchangeId, {
        resolve,
        reject: () => {},
        data: { type, exchangeId },
      });
      this.broadcastBreakpointHit(exchangeId, type);
    });
  }

  private broadcastBreakpointHit(exchangeId: string, type: 'request' | 'response'): void {
    const message = JSON.stringify({
      type: 'breakpoint_hit',
      data: { exchangeId, type },
    });
    for (const client of this.wss.clients) {
      if ((client as any).readyState === 1) {
        (client as any).send(message);
      }
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      if (this.options.autoConfigureTrust) {
        try {
          loadOrCreateRootCA();
          process.env.NODE_EXTRA_CA_CERTS = CA_CERT_PATH;
          this.log('info', `Configured NODE_EXTRA_CA_CERTS=${CA_CERT_PATH}`);
        } catch (err) {
          this.log('verbose', `Could not auto-configure trust: ${(err as Error).message}`);
        }
      }

      this.proxyServer.listen(this.options.port, this.options.host, () => {
        this.log('info', `Proxy server started on ${this.options.host}:${this.options.port}`);
        this.log('info', `WebSocket server on port ${this.options.wsPort}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.proxyServer.close(() => {
        this.wss.close();
        for (const server of this.tlsServers.values()) {
          server.close();
        }
        this.tlsServers.clear();
        resolve();
      });
    });
  }

  getExchanges(): CapturedExchange[] {
    return Array.from(this.exchanges.values());
  }

  getExchange(id: string): CapturedExchange | undefined {
    return this.exchanges.get(id);
  }

  addBreakpoint(breakpoint: Omit<Breakpoint, 'id' | 'hitCount'>): Breakpoint {
    const bp: Breakpoint = {
      ...breakpoint,
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      hitCount: 0,
    };
    this.breakpoints.set(bp.id, bp);
    return bp;
  }

  removeBreakpoint(id: string): boolean {
    return this.breakpoints.delete(id);
  }

  listBreakpoints(): Breakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  async resumeBreakpoint(exchangeId: string, modifications?: any): Promise<void> {
    const pending = this.pendingRequests.get(exchangeId);
    if (pending) {
      pending.resolve(modifications);
      this.pendingRequests.delete(exchangeId);
    }
  }

  clearExchanges(): void {
    this.exchanges.clear();
  }

  exportHar() {
    const entries = Array.from(this.exchanges.values())
      .filter(e => e.response)
      .map(e => this.exchangeToHarEntry(e));

    return {
      version: '1.2',
      creator: {
        name: 'Conflux Lens SDK',
        version: '0.1.0',
      },
      pages: [],
      entries,
    };
  }

  private exchangeToHarEntry(exchange: CapturedExchange): any {
    const request = exchange.request;
    const response = exchange.response!;

    return {
      startedDateTime: new Date(request.timestamp).toISOString(),
      time: response.duration,
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.headers).map(([name, value]) => ({
          name,
          value: Array.isArray(value) ? value.join(', ') : String(value),
        })),
        queryString: [],
        postData: request.body ? {
          mimeType: request.headers['content-type'] as string || 'text/plain',
          text: request.body,
        } : undefined,
        headersSize: -1,
        bodySize: request.bodySize || -1,
      },
      response: {
        status: response.statusCode,
        statusText: response.statusMessage,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(response.headers).map(([name, value]) => ({
          name,
          value: Array.isArray(value) ? value.join(', ') : String(value),
        })),
        content: {
          size: response.bodySize || 0,
          mimeType: response.headers['content-type'] as string || 'text/plain',
          text: response.body,
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: response.bodySize || -1,
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: -1,
        connect: -1,
        send: 0,
        wait: response.duration,
        receive: 0,
      },
    };
  }

  private log(level: ProxyLogLevel, message: string): void {
    const levels: Record<ProxyLogLevel, number> = {
      silent: 0,
      info: 1,
      verbose: 2,
      debug: 3,
    };

    if (levels[level] <= levels[this.options.logLevel || 'info']) {
      console.log(`[ProxyServer] ${message}`);
    }
  }
}

export function createProxyServer(options?: ProxyServerOptions) {
  return new ProxyServer(options);
}
