import forge from 'node-forge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME_DIR = os.homedir();
const IS_WINDOWS = process.platform === 'win32';

// Use platform-appropriate path
const CA_BASE_DIR = IS_WINDOWS 
  ? path.join(process.env.USERPROFILE || 'C:\\Users\\Default', '.conflux-lens')
  : path.join(HOME_DIR, '.conflux-lens');

export const CA_DIR = CA_BASE_DIR;
export const CA_CERT_PATH = path.join(CA_BASE_DIR, 'ca.pem');
export const CA_KEY_PATH = path.join(CA_BASE_DIR, 'ca-key.pem');
export const CERT_CACHE_DIR = path.join(CA_BASE_DIR, 'certs');

export interface CertPair {
  cert: string;
  key: string;
}

// In-memory cache for generated certs (hostname -> CertPair)
const certCache = new Map<string, CertPair>();

/**
 * Generate a root CA certificate and private key.
 */
export function generateRootCA(): { cert: string; key: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: 'commonName', value: 'Conflux Lens CA' },
    { name: 'organizationName', value: 'Conflux Lens' },
    { name: 'organizationalUnitName', value: 'Development' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // CA extensions
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true,
      pathLenConstraint: 0,
    } as any,
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    } as any,
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  // Self-sign
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  return { cert: certPem, key: keyPem };
}

/**
 * Load or generate the root CA certificate.
 * On first run, generates a new CA and saves it.
 */
export function loadOrCreateRootCA(): { cert: string; key: string } {
  try {
    if (fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH)) {
      const cert = fs.readFileSync(CA_CERT_PATH, 'utf8');
      const key = fs.readFileSync(CA_KEY_PATH, 'utf8');
      return { cert, key };
    }
  } catch (err) {
    console.warn('Warning: Could not read existing CA cert, generating new one');
  }

  // Generate new CA
  console.log('\n\ud83d\udd10 HTTPS Interception: Generating root CA certificate...');
  const { cert, key } = generateRootCA();

  try {
    if (!fs.existsSync(CA_DIR)) {
      fs.mkdirSync(CA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CERT_CACHE_DIR)) {
      fs.mkdirSync(CERT_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CA_CERT_PATH, cert, 'utf8');
    fs.writeFileSync(CA_KEY_PATH, key, 'utf8');
    console.log(`   Location: ${CA_CERT_PATH}`);
    console.log(`   Trust in Node.js: export NODE_EXTRA_CA_CERTS=${CA_CERT_PATH}`);
    console.log('');
  } catch (err) {
    console.error('Error: Could not save CA certificate:', err);
    throw err;
  }

  return { cert, key };
}

/**
 * Generate a dynamically signed certificate for a specific hostname.
 * Uses the root CA to sign the certificate.
 */
export function generateCertForHost(hostname: string): CertPair {
  // Check cache first
  const cached = certCache.get(hostname);
  if (cached) {
    return cached;
  }

  const { cert: caCert, key: caKey } = loadOrCreateRootCA();

  // Parse CA
  const caCertForge = forge.pki.certificateFromPem(caCert);
  const caPrivateKey = forge.pki.privateKeyFromPem(caKey);

  // Generate key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16) + Math.random().toString(16).slice(2);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: hostname },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(caCertForge.subject.attributes);

  // SAN extension for modern browsers/clients
  const altNames: any[] = [
    { type: 2, value: hostname }, // DNS type = 2
  ];

  // Also add IP addresses if hostname looks like an IP
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    altNames.push({ type: 7, ip: hostname });
  }

  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    } as any,
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    } as any,
    {
      name: 'subjectAltName',
      altNames,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    } as any,
    {
      name: 'nsCertType',
      server: true,
    } as any,
  ]);

  // Sign with CA
  cert.sign(caPrivateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  const pair: CertPair = { cert: certPem, key: keyPem };
  certCache.set(hostname, pair);

  return pair;
}

/**
 * Clear the in-memory certificate cache.
 */
export function clearCertCache(): void {
  certCache.clear();
}

/**
 * Get cache size.
 */
export function getCacheSize(): number {
  return certCache.size;
}

/**
 * Remove a specific hostname from cache.
 */
export function removeFromCache(hostname: string): boolean {
  return certCache.delete(hostname);
}

/**
 * Get the CA certificate fingerprint (SHA256) for display.
 */
export function getCAFingerprint(): string {
  const { cert } = loadOrCreateRootCA();
  const certForge = forge.pki.certificateFromPem(cert);
  const fingerprint = forge.md.sha256.create().update(forge.pki.certificateToPem(certForge)).digest().toHex();
  return fingerprint.match(/.{2}/g)?.join(':').toUpperCase() || fingerprint;
}
