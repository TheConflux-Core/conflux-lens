/**
 * Programmatic Proxy Server
 * Creates and manages an HTTP/HTTPS proxy server with interception capabilities
 */

import http from 'http';
import * as net from 'net';
import * as zlib from 'zlib';
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
  private pendingConnects = new Map<string, CapturedExchange>();
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

      // Always create the response with metadata, even without body
      const response: CapturedResponse = {
        statusCode: proxyRes.statusCode || 0,
        statusMessage: proxyRes.statusMessage || '',
        headers: this.normalizeHeaders(proxyRes.headers),
        body: undefined,
        bodySize: 0,
        duration,
        timestamp: Date.now(),
      };

      // Save response metadata immediately (status, headers, timing)
      this.updateExchange(exchangeId, { response });

      // Then try to capture body for text/json content types
      if (proxyRes.headers['content-type']?.includes('application/json') ||
          proxyRes.headers['content-type']?.includes('text/')) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          if (chunks.length > 0) {
            const combined = Buffer.concat(chunks);
            response.body = combined.length > 100000
              ? combined.toString('utf8').substring(0, 100000) + '... [truncated]'
              : combined.toString('utf8');
            response.bodySize = combined.length;
          }
          // Re-broadcast with body data
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
            request.body = combined.length > 100000
              ? combined.toString('utf8').substring(0, 100000) + '... [truncated]'
              : combined.toString('utf8');
            request.bodySize = combined.length;
            // Re-broadcast with body data
            this.updateExchange(exchangeId, { request });
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

    // Don't broadcast CONNECT tunnel exchange yet - wait for actual HTTP data
    this.updatePendingConnect(exchangeId, exchange);

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
        // Upstream TLS connected - now we handle decrypted data manually
        // (NO pipe() — pipe + on('data') conflict causes data loss, especially with binary WS frames)

        // Buffer for capturing HTTP request data over TLS
        let requestBuf = '';
        let responseBuf = '';
        let requestHeadersParsed = false;
        let responseHeadersParsed = false;
        let requestHeaderEnd = -1;
        let responseHeaderEnd = -1;
        // WebSocket frame parsing state (for Discord Gateway, etc.)
        let isWebSocket = false;
        let wsFrameBuffer = Buffer.alloc(0);
        const wsMessages: string[] = [];
        // zlib-stream decompression for Discord Gateway binary frames
        const wsZlibInflator = new zlib.InflateRaw();
        let wsZlibBuf = '';
        const WS_ZLIB_SYNC = '\x00\x00\xff\xff';
        wsZlibInflator.on('data', (decompressed: Buffer) => {
          // Each zlib data event = one complete decompressed Gateway message
          // (Discord's zlib-stream uses Z_SYNC_FLUSH boundaries which are consumed
          // by the inflator internally — the SYNC_FLUSH marker never appears in output)
          const text = decompressed.toString('utf8').trim();
          if (text) {
            wsMessages.push(text);
            // Push immediately to exchange (zlib is async)
            if (exchange.response) {
              exchange.response.websocketMessages = [...wsMessages];
              this.updateExchange(exchangeId, { response: exchange.response });
            }
          }
        });
        wsZlibInflator.on('error', (err: Error) => {
          this.log('verbose', `zlib inflate error: ${err.message}`);
        });

        // Log request data for capture/exchange + forward to upstream
        clientTlsSocket.on('data', (chunk: Buffer) => {
          try {
            // Forward client data to upstream (replaces pipe())
            upstreamTls.write(chunk);
            
            requestBuf += chunk.toString('utf8');
            // Check if this looks like an HTTP request
            const httpMethodMatch = requestBuf.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD) /);
            if (httpMethodMatch && !requestHeadersParsed) {
              // Find end of headers
              requestHeaderEnd = requestBuf.indexOf('\r\n\r\n');
              if (requestHeaderEnd === -1) return; // Wait for more data
              requestHeadersParsed = true;

              // Parse the request line
              const firstLine = requestBuf.split('\r\n')[0];
              const parts = firstLine.split(' ');
              const method = parts[0] || 'GET';
              const path = parts[1] || '/';

              // Determine URL
              const url = `https://${hostname}${path}`;

              // Parse headers
              const headerSection = requestBuf.substring(0, requestHeaderEnd);
              const headerLines = headerSection.split('\r\n').slice(1);
              const headers: Record<string, string> = {};
              for (const line of headerLines) {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                  headers[line.substring(0, colonIdx).toLowerCase()] = line.substring(colonIdx + 1).trim();
                }
              }

              // Body starts after headers
              const bodyStart = requestHeaderEnd + 4;
              const body = requestBuf.substring(bodyStart);
              const request: CapturedRequest = {
                id: exchangeId,
                timestamp: Date.now(),
                method,
                url,
                protocol: 'HTTPS',
                host: hostname,
                path,
                headers,
                body: body || undefined,
                bodySize: body.length || 0,
              };
              exchange.request = request;
              this.updateExchange(exchangeId, { request });
            } else if (requestHeadersParsed && requestHeaderEnd >= 0) {
              // Update request body as more data arrives
              const body = requestBuf.substring(requestHeaderEnd + 4);
              if (body) {
                exchange.request.body = body.length > 100000 ? body.substring(0, 100000) + '... [truncated]' : body;
                exchange.request.bodySize = body.length;
                this.updateExchange(exchangeId, { request: exchange.request });
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        });

        // Log response data
        upstreamTls.on('data', (chunk: Buffer) => {
          try {
            // Forward upstream data to client (replaces pipe())
            clientTlsSocket.write(chunk);
            
            // After 101 Switching Protocols, parse WebSocket frames instead of HTTP
            if (isWebSocket) {
              wsFrameBuffer = Buffer.concat([wsFrameBuffer, chunk]);
              wsFrameBuffer = Buffer.from(this.parseWsFromBuffer(wsFrameBuffer, wsMessages, wsZlibInflator, wsZlibBuf, WS_ZLIB_SYNC));

              // Text frames pushed to wsMessages synchronously — update exchange immediately
              if (wsMessages.length > 0) {
                if (!exchange.response) {
                  exchange.response = {
                    statusCode: 101,
                    statusMessage: 'Switching Protocols',
                    headers: {},
                    bodySize: 0,
                    duration: Date.now() - exchange.request.timestamp,
                    timestamp: Date.now(),
                    websocketMessages: [...wsMessages],
                  };
                } else {
                  exchange.response.websocketMessages = [...wsMessages];
                }
                this.updateExchange(exchangeId, { response: exchange.response });
              }
              return;
            }

            responseBuf += chunk.toString('utf8');
            if (responseBuf.startsWith('HTTP/') && !responseHeadersParsed) {
              const headerEnd = responseBuf.indexOf('\r\n\r\n');
              if (headerEnd === -1) return; // Wait for more data

              responseHeadersParsed = true;
              responseHeaderEnd = headerEnd;
              const firstLine = responseBuf.split('\r\n')[0];
              const match = firstLine.match(/HTTP\/\d\.\d (\d+) (.*)/);
              if (match) {
                const statusCode = parseInt(match[1], 10);
                const statusMessage = match[2];

                // Detect WebSocket upgrade (101 Switching Protocols)
                if (statusCode === 101) {
                  isWebSocket = true;
                  this.log('info', `WebSocket upgrade to ${hostname}:${port}`);
                  // Parse upgrade response headers
                  const headerSection = responseBuf.substring(0, responseBuf.indexOf('\r\n\r\n'));
                  const headerLines = headerSection.split('\r\n').slice(1);
                  const upgradeHeaders: Record<string, string> = {};
                  for (const line of headerLines) {
                    const colonIdx = line.indexOf(':');
                    if (colonIdx > 0) {
                      upgradeHeaders[line.substring(0, colonIdx).toLowerCase()] = line.substring(colonIdx + 1).trim();
                    }
                  }
                  exchange.response = {
                    statusCode,
                    statusMessage,
                    headers: upgradeHeaders,
                    bodySize: 0,
                    duration: Date.now() - exchange.request.timestamp,
                    timestamp: Date.now(),
                    websocketMessages: [],
                  };
                  this.updateExchange(exchangeId, { response: exchange.response });

                  // CRITICAL: Handle trailing WS frame data in the same TCP chunk
                  // The 101 response headers + WS frames can arrive in a single packet
                  const wsHeaderEnd = responseBuf.indexOf('\r\n\r\n');
                  const headersByteLen = Buffer.byteLength(responseBuf.substring(0, wsHeaderEnd + 4), 'utf8');
                  const trailingChunk = chunk.slice(headersByteLen);
                  if (trailingChunk.length > 0) {
                    this.log('debug', `Feeding ${trailingChunk.length} trailing WS bytes from initial chunk`);
                    wsFrameBuffer = Buffer.concat([wsFrameBuffer, trailingChunk]);
                    wsFrameBuffer = Buffer.from(this.parseWsFromBuffer(wsFrameBuffer, wsMessages, wsZlibInflator, wsZlibBuf, WS_ZLIB_SYNC));
                    // Update exchange with any parsed messages
                    if (wsMessages.length > 0) {
                      exchange.response.websocketMessages = [...wsMessages];
                      this.updateExchange(exchangeId, { response: exchange.response });
                    }
                  }
                  return;
                }

                // Parse headers
                const headerSection = responseBuf.substring(0, headerEnd);
                const headerLines = headerSection.split('\r\n').slice(1);
                const headers: Record<string, string> = {};
                for (const line of headerLines) {
                  const colonIdx = line.indexOf(':');
                  if (colonIdx > 0) {
                    headers[line.substring(0, colonIdx).toLowerCase()] = line.substring(colonIdx + 1).trim();
                  }
                }

                // Body starts after headers
                const bodyStart = headerEnd + 4;
                const rawBody = responseBuf.substring(bodyStart);

                // Decode chunked transfer encoding if needed
                const isChunked = headers['transfer-encoding']?.toLowerCase().includes('chunked');
                const decodedBody = isChunked ? this.decodeChunkedBody(rawBody) : rawBody;

                const response: CapturedResponse = {
                  statusCode,
                  statusMessage,
                  headers,
                  body: decodedBody.length > 100000 ? decodedBody.substring(0, 100000) + '... [truncated]' : decodedBody,
                  bodySize: decodedBody.length,
                  duration: Date.now() - exchange.request.timestamp,
                  timestamp: Date.now(),
                };
                this.updateExchange(exchangeId, { response });
              }
            } else if (responseHeadersParsed && responseHeaderEnd >= 0) {
              // Update response body as more data arrives
              const rawBody = responseBuf.substring(responseHeaderEnd + 4);
              if (rawBody && exchange.response) {
                const isChunked = exchange.response.headers['transfer-encoding']?.toString().toLowerCase().includes('chunked');
                const decodedBody = isChunked ? this.decodeChunkedBody(rawBody) : rawBody;
                exchange.response.body = decodedBody.length > 100000 ? decodedBody.substring(0, 100000) + '... [truncated]' : decodedBody;
                exchange.response.bodySize = decodedBody.length;
                this.updateExchange(exchangeId, { response: exchange.response });
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

  /**
   * Parse RFC 6455 WebSocket frames from a buffer.
   * Handles text frames (opcode 0x1) and binary frames (opcode 0x2) with zlib-stream decompression.
   * Partial frames stay in the returned buffer for the next call.
   */
  private parseWsFromBuffer(
    buffer: Buffer,
    wsMessages: string[],
    zlibInflator: zlib.InflateRaw,
    prevBuf: string,
    SYNC_FLUSH: string
  ): Buffer {
    if (buffer.length < 2) return buffer;
    let offset = 0;
    while (buffer.length - offset >= 2) {
      const b1 = buffer[offset];
      const b2 = buffer[offset + 1];
      const opcode = b1 & 0x0F;
      const hasMask = (b2 >> 7) & 1;
      let payloadLen = b2 & 0x7F;
      let headerLen = 2;
      if (payloadLen === 126) {
        if (buffer.length - offset < 4) break;
        payloadLen = buffer.readUInt16BE(offset + 2);
        headerLen += 2;
      } else if (payloadLen === 127) {
        if (buffer.length - offset < 10) break;
        payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
        headerLen += 8;
      }
      let maskLen = 0;
      if (hasMask) {
        if (buffer.length - offset < headerLen + 4) break;
        maskLen = 4;
      }
      const frameLen = headerLen + maskLen + payloadLen;
      if (buffer.length - offset < frameLen) break;

      const rawPayload = Buffer.from(buffer.slice(offset + headerLen + maskLen, offset + frameLen));
      // Unmask if needed
      if (hasMask) {
        const maskKey = buffer.slice(offset + headerLen, offset + headerLen + 4);
        for (let i = 0; i < rawPayload.length; i++) {
          rawPayload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x1) {
        // Text frame
        const text = rawPayload.toString('utf8');
        wsMessages.push(text);
        this.log('debug', `WS-text[${wsMessages.length - 1}]: ${text.substring(0, 200)}`);
      } else if (opcode === 0x2) {
        // Binary frame — zlib-stream compressed (Discord Gateway)
        let binaryData = rawPayload;
        // Strip optional 2-byte zlib header (0x78 0x9C / 0x78 0xDA)
        if (binaryData.length >= 2 && binaryData[0] === 0x78 && (binaryData[1] === 0x9C || binaryData[1] === 0xDA)) {
          binaryData = binaryData.slice(2);
        }
        zlibInflator.write(binaryData);
      }

      offset += frameLen;
    }
    return buffer.slice(offset);
  }

  private normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = value as string | string[];
    }
    return result;
  }

  /**
   * Decode HTTP chunked transfer encoding.
   * Input: "1a\r\n{...json...}\r\n0\r\n\r\n"
   * Output: "{...json...}"
   */
  private decodeChunkedBody(raw: string): string {
    let result = '';
    let pos = 0;
    while (pos < raw.length) {
      // Find end of chunk size line
      const crlf = raw.indexOf('\r\n', pos);
      if (crlf === -1) break;
      const sizeHex = raw.substring(pos, crlf).trim();
      if (!sizeHex) break;
      const size = parseInt(sizeHex, 16);
      if (isNaN(size) || size === 0) break; // Last chunk
      pos = crlf + 2; // Skip CRLF after size
      if (pos + size > raw.length) break; // Incomplete chunk
      result += raw.substring(pos, pos + size);
      pos += size + 2; // Skip CRLF after chunk data
    }
    return result || raw; // Fall back to raw if decoding fails
  }

  private broadcastExchange(exchange: CapturedExchange): void {
    const message = JSON.stringify({ type: 'exchange', data: exchange });
    for (const client of this.wss.clients) {
      if ((client as any).readyState === 1) {
        (client as any).send(message);
      }
    }
  }

  private updatePendingConnect(id: string, exchange: CapturedExchange): void {
    // Store without broadcasting - will be promoted when real HTTP data is captured
    this.pendingConnects.set(id, exchange);
  }

  private updateExchange(id: string, update: Partial<CapturedExchange>): void {
    let exchange = this.exchanges.get(id);
    // If not in exchanges, check pendingConnects and promote it
    if (!exchange) {
      exchange = this.pendingConnects.get(id);
      if (exchange) {
        this.pendingConnects.delete(id);
        this.exchanges.set(id, exchange);
        // First broadcast - listener gets initial state
        this.broadcastExchange(exchange);
      }
    }
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
    const exchange = this.exchanges.get(exchangeId);
    const message = JSON.stringify({
      type: 'breakpoint_hit',
      data: {
        exchangeId,
        type,
        request: exchange?.request ? {
          url: exchange.request.url,
          method: exchange.request.method,
          headers: exchange.request.headers,
          body: exchange.request.body,
        } : undefined,
        response: exchange?.response ? {
          statusCode: exchange.response.statusCode,
          statusMessage: exchange.response.statusMessage,
          headers: exchange.response.headers,
          body: exchange.response.body,
        } : undefined,
      },
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
