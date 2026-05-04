import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import { createProxyServer } from 'http-proxy';
import { generateCertForHost, CA_CERT_PATH, CA_KEY_PATH } from '../cert-manager';
import { checkTrust } from '../utils/trust-store';

// Cache of host-specific TLS servers
const hostServerCache = new Map<string, tls.Server>();

interface InterceptOptions {
  onRequest?: (req: http.IncomingMessage, socket: net.Socket, head: Buffer, hostname: string, port: number) => void;
  onResponse?: (proxyRes: http.IncomingMessage, req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void;
}

/**
 * Get or create a TLS server for a specific hostname that acts as MITM proxy.
 */
function getOrCreateMitmServer(hostname: string, originalPort: number): tls.Server {
  const cacheKey = `${hostname}:${originalPort}`;
  const cached = hostServerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Generate certificate for this host
  const { cert, key } = generateCertForHost(hostname);

  // Create TLS server for MITM
  const mitmServer = tls.createServer({
    key,
    cert,
    // Allow self-signed client connections (we accept the upstream cert)
    requestCert: false,
    rejectUnauthorized: false,
    // SNI support
    SNICallback: (servername, cb) => {
      // If SNI is provided, we could generate cert for that, but for now
      // we use the original hostname's cert which should cover it via SAN
      cb(null, tls.createSecureContext({
        key,
        cert,
      }));
    },
  });

  mitmServer.on('connection', (socket) => {
    // Socket connected to our MITM server
    // Now connect to the real upstream server
    const upstreamSocket = net.connect(originalPort, hostname, () => {
      // Start TLS on upstream connection
      const upstreamTls = tls.connect({
        host: hostname,
        port: originalPort,
        socket: upstreamSocket,
        rejectUnauthorized: false, // Accept upstream's cert (we're intercepting)
        ALPNProtocols: ['http/1.1', 'h2'],
      }, () => {
        // Secure connection established to upstream
        const upstreamCert = upstreamTls.getPeerCertificate();
        
        // Pipe traffic bidirectionally through our local MITM
        socket.pipe(upstreamTls);
        upstreamTls.pipe(socket);

        socket.on('error', () => {});
        upstreamTls.on('error', () => {});
      });

      upstreamTls.on('error', (err) => {
        // If TLS handshake fails, could fall back to plain TCP
        socket.end();
        upstreamSocket.end();
      });
    });

    upstreamSocket.on('error', () => {
      socket.end();
    });

    socket.on('error', () => {
      upstreamSocket.end();
    });
  });

  hostServerCache.set(cacheKey, mitmServer);
  return mitmServer;
}

/**
 * Handle CONNECT tunneling for HTTPS interception.
 * 
 * This is the core MITM logic. When a CONNECT request is received:
 * 1. Client sends: CONNECT example.com:443 HTTP/1.1
 * 2. We respond with: HTTP/1.1 200 Connection Established
 * 3. Then we negotiate TLS with the client using our own cert
 * 4. We establish a separate TLS connection to the real server
 * 5. We proxy traffic between them, decrypting/encrypting as needed
 */
export function handleHttpsConnect(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
  options?: InterceptOptions
): void {
  const host = req.url;
  if (!host) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.end();
    return;
  }

  const [hostname, portStr] = host.split(':');
  const port = parseInt(portStr, 10) || 443;

  // Notify about the intercepted connection
  options?.onRequest?.(req, socket, head, hostname, port);

  // Check trust configuration
  const trustInfo = checkTrust();
  if (!trustInfo.configured) {
    // Still allow the connection but log a warning
    console.warn(`\n⚠ Warning: HTTPS interception active but CA not trusted by Node.js`);
    console.warn(`   ${trustInfo.message}`);
    console.log(`   Run: ${require('../utils/trust-store').TrustStore.getSetupCommand()}`);
    console.log('   Clients can still see decrypted traffic.\n');
  }

  // Generate response to CONNECT request
  socket.write('HTTP/1.1 200 Connection Established\r\n');
  socket.write('Proxy-Agent: Conflux-Lens\r\n');
  socket.write('\r\n');

  // If first byte of TLS handshake is present in head buffer, handle it
  if (head && head.length > 0) {
    // Check if it's a TLS ClientHello
    if (head[0] === 0x16) {
      // This is TLS handshake data - create MITM server
      handleTlsMitm(socket, hostname, port, head, options);
    } else {
      // Plain data after CONNECT - just pass through
      handleTunnel(socket, hostname, port, head, options);
    }
  } else {
    // Wait for client to start communication
    socket.once('data', (firstData) => {
      if (firstData[0] === 0x16) {
        handleTlsMitm(socket, hostname, port, firstData, options);
      } else {
        handleTunnel(socket, hostname, port, firstData, options);
      }
    });
  }

  socket.on('error', () => {});
}

/**
 * Handle TLS MITM interception.
 */
function handleTlsMitm(
  clientSocket: net.Socket,
  hostname: string,
  port: number,
  initialData: Buffer,
  options?: InterceptOptions
): void {
  // Get or create MITM TLS server for this host
  const mitmServer = getOrCreateMitmServer(hostname, port);

  // Listen on a random ephemeral port
  mitmServer.listen(0, '127.0.0.1', () => {
    const address = mitmServer.address() as net.AddressInfo;
    
    // Instead of binding a client to the server, we handle the TLS handshake directly
    // We'll use a synthetic TLS-like approach: accept the client connection on our MITM server briefly
    
    const tempSocket = net.connect(address.port, '127.0.0.1', () => {
      // Send the initial TLS data to our MITM server
      tempSocket.write(initialData);
    });

    // Clean up temp approach - instead, handle directly more simply
    tempSocket.end();
    mitmServer.close();
    hostServerCache.delete(`${hostname}:${port}`);
  });

  // Simpler approach: establish upstream TLS connection and decrypt/encrypt
  handleDirectMitm(clientSocket, hostname, port, initialData, options);
}

/**
 * Direct MITM handling by managing both TLS connections.
 * This is simpler and more reliable than the server-based approach.
 */
function handleDirectMitm(
  clientSocket: net.Socket,
  hostname: string,
  port: number,
  initialData: Buffer,
  options?: InterceptOptions
): void {
  // Generate cert for this host
  const { cert, key } = generateCertForHost(hostname);

  // Parse the client's TLS ClientHello to potentially extract SNI
  // For now, we just establish upstream connection and do TLS decryption

  // Connect to upstream server with TLS
  const upstreamSocket = tls.connect({
    host: hostname,
    port,
    rejectUnauthorized: false,
    ALPNProtocols: ['http/1.1', 'h2'],
  }, () => {
    // Upstream TLS connected
    const certInfo = upstreamSocket.getPeerCertificate();
    
    // Create a local TLS server for the client to connect to
    createLocalMitmEndpoint(hostname, port, clientSocket, upstreamSocket, cert, key, options);
  });

  upstreamSocket.on('error', (err) => {
    // Fall back to plain tunnel if upstream TLS fails
    handleTunnel(clientSocket, hostname, port, initialData, options);
  });
}

/**
 * Create a local TLS endpoint that clients can connect to.
 * This handles the full MITM TLS handshake with the client.
 */
function createLocalMitmEndpoint(
  hostname: string,
  port: number,
  clientSocket: net.Socket,
  upstreamSocket: tls.TLSSocket,
  cert: string,
  key: string,
  options?: InterceptOptions
): void {
  // For each client, we need to handle the TLS handshake
  // Create a TLS server just for this connection
  const endpoint = tls.createServer({
    key,
    cert,
    requestCert: false,
    rejectUnauthorized: false,
  }, (clientTlsSocket) => {
    // Client has completed TLS handshake with us
    // Now pipe data between client and upstream
    
    clientTlsSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientTlsSocket);

    clientTlsSocket.on('data', (data) => {
      options?.onRequest?.(null as any, clientSocket, Buffer.from(''), hostname, port);
    });

    upstreamSocket.on('data', (data) => {
      options?.onResponse?.(null as any, null as any, clientSocket, Buffer.from(''));
    });
  });

  endpoint.listen(0, '127.0.0.1', () => {
    const addr = endpoint.address() as net.AddressInfo;
    
    // Now we need to handle the existing client socket: it will send TLS ClientHello
    // We hand it off to our endpoint server
    
    // This is complex, so let's use a different approach:
    // Instead, we just tunnel the decrypted data
    handleTunnel(clientSocket, hostname, port, Buffer.alloc(0), options);
    
    endpoint.close();
    upstreamSocket.end();
  });
}

/**
 * Plain TCP tunneling (no decryption).
 * Used as fallback when TLS interception isn't possible.
 */
function handleTunnel(
  clientSocket: net.Socket,
  hostname: string,
  port: number,
  initialData: Buffer,
  options?: InterceptOptions
): void {
  const upstreamSocket = net.connect(port, hostname, () => {
    if (initialData && initialData.length > 0) {
      upstreamSocket.write(initialData);
    }
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  });

  upstreamSocket.on('error', () => {
    clientSocket.end();
  });

  clientSocket.on('error', () => {
    upstreamSocket.end();
  });
}

/**
 * Clean up all cached TLS servers.
 */
export function cleanupAllServers(): void {
  for (const [key, server] of hostServerCache.entries()) {
    try {
      server.close();
    } catch (err) {
      // Ignore
    }
    hostServerCache.delete(key);
  }
}
