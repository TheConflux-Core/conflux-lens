# HTTPS Intercept Module

## Overview

HTTPS MITM (Man-in-the-Middle) interception for inspecting encrypted LLM API traffic — dynamically-generated CA certificates similar to BurpSuite. The MITM logic lives in `packages/sdk/src/proxy-server.ts`.

## Architecture

### 1. Root CA Generation (`cert-manager.ts`)

On first run, generates a root CA certificate and private key:
- Location: `~/.conflux-lens/ca.pem` (cert) and `ca-key.pem` (key)
- 2048-bit RSA key pair
- 10-year validity
- Stored in user's home directory

### 2. Dynamic Cert Signing

For each unique hostname requested via CONNECT:
- Generates a host-specific certificate signed by the root CA
- Includes SAN (Subject Alternative Name) for the hostname
- Caches in memory for performance
- 1-year validity per host cert

### 3. CONNECT Tunneling (SDK proxy-server.ts)

Standard HTTP CONNECT flow — handled by `ProxyServer.handleHttpsConnect()`:
1. Client sends: `CONNECT example.com:443 HTTP/1.1`
2. Proxy responds: `HTTP/1.1 200 Connection Established`
3. Client initiates TLS handshake with proxy
4. Proxy negotiates TLS with its own cert (signed by CA)
5. Proxy establishes separate TLS connection to upstream
6. Proxy decrypts, logs, re-encrypts traffic

### 4. Trust Configuration (`trust-store.ts`)

Node.js requires `NODE_EXTRA_CA_CERTS` environment variable to trust custom CAs. The module:
- Checks if already configured
- Provides setup commands for current or persistent session
- Validates CA matches the deployed one

## API

### `handleHttpsConnect(req, socket, head, options)`

Handles HTTPS CONNECT tunneling.

```typescript
handleHttpsConnect(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
  options?: {
    onRequest?: (req, socket, head, hostname, port) => void;
    onResponse?: (proxyRes, req, socket, head) => void;
  }
)
```

### `loadOrCreateRootCA()`

Loads existing CA or generates new one. Returns cert and key as PEM strings.

### `generateCertForHost(hostname)`

Generates host-specific certificate signed by root CA.

### `TrustStore.checkTrust()`

Returns `{ configured: boolean, message: string }` indicating if Node.js trust is configured.

## Usage in Proxy

MITM logic is integrated directly into the ProxyServer class. See `packages/sdk/src/proxy-server.ts` → `handleHttpsConnect()`.

## Setup Instructions

```bash
# Generate CA certificate
npm run setup-trust setup

# Follow printed instructions to configure Node.js
export NODE_EXTRA_CA_CERTS="~/.conflux-lens/ca.pem"

# Verify
npm run setup-trust verify
```

For other languages (Python, Ruby, etc.), configure their respective trust stores to trust `~/.conflux-lens/ca.pem`.

## Files

- `src/cert-manager.ts` - CA generation and certificate signing
- `packages/sdk/src/proxy-server.ts` - CONNECT tunneling and MITM logic (handleHttpsConnect)
- `src/utils/trust-store.ts` - Node.js trust configuration
- `src/scripts/setup-trust.ts` - CLI for setup tasks
- `src/types.d.ts` - TypeScript declarations for node-forge

## Security Notes

- CA private key is stored unencrypted - protect `~/.conflux-lens/ca-key.pem`
- Generated host certs are cached in memory, not persisted to disk
- Each unique hostname gets its own certificate
- Certificate chain: Host Cert → Root CA
- Upstream certificates are not validated (interception mode)

See main README for complete project documentation.
