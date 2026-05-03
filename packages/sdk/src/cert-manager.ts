/**
 * Simplified CA certificate management for the SDK
 * Based on node-forge for certificate generation
 */

const forge: any = require('node-forge');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME_DIR = os.homedir();
export const CA_DIR = path.join(HOME_DIR, '.ai-agent-proxy');
export const CA_CERT_PATH = path.join(CA_DIR, 'ca.pem');
export const CA_KEY_PATH = path.join(CA_DIR, 'ca-key.pem');
export const CERT_CACHE_DIR = path.join(CA_DIR, 'certs');

export interface CertPair {
  cert: string;
  key: string;
}

const certCache = new Map<string, CertPair>();

export function generateRootCA(): { cert: string; key: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: 'commonName', value: 'AI Agent Proxy CA' },
    { name: 'organizationName', value: 'AI Agent Proxy' },
    { name: 'organizationalUnitName', value: 'SDK' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

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

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  return { cert: certPem, key: keyPem };
}

export function loadOrCreateRootCA(customDir?: string): { cert: string; key: string } {
  const baseDir = customDir || CA_DIR;
  const certPath = path.join(baseDir, 'ca.pem');
  const keyPath = path.join(baseDir, 'ca-key.pem');

  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const cert = fs.readFileSync(certPath, 'utf8');
      const key = fs.readFileSync(keyPath, 'utf8');
      return { cert, key };
    }
  } catch (err) {
    // Ignore, will generate new
  }

  const { cert, key } = generateRootCA();

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const cacheDir = path.join(baseDir, 'certs');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(certPath, cert, 'utf8');
    fs.writeFileSync(keyPath, key, 'utf8');
  } catch (err) {
    throw new Error(`Could not save CA certificate: ${(err as Error).message}`);
  }

  return { cert, key };
}

export function generateCertForHost(hostname: string, customDir?: string): CertPair {
  const cacheKey = `${customDir || 'default'}:${hostname}`;
  const cached = certCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseDir = customDir || CA_DIR;
  const { cert: caCert, key: caKey } = loadOrCreateRootCA(baseDir);

  const caCertForge = forge.pki.certificateFromPem(caCert);
  const caPrivateKey = forge.pki.privateKeyFromPem(caKey);

  const keys = forge.pki.rsa.generateKeyPair(2048);

  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16) + Math.random().toString(16).slice(2);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  cert.setSubject([{ name: 'commonName', value: hostname }]);
  cert.setIssuer(caCertForge.subject.attributes);

  const altNames: any[] = [{ type: 2, value: hostname }];
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
  ]);

  cert.sign(caPrivateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  const pair: CertPair = { cert: certPem, key: keyPem };
  certCache.set(cacheKey, pair);

  return pair;
}

export function clearCertCache(customDir?: string): void {
  Array.from(certCache.keys())
    .filter(k => k.startsWith(customDir ? `${customDir}:` : 'default:'))
    .forEach(k => certCache.delete(k));
}

export function getCAFingerprint(customDir?: string): string {
  const { cert } = loadOrCreateRootCA(customDir);
  const certForge = forge.pki.certificateFromPem(cert);
  const fingerprint = forge.md.sha256.create().update(forge.pki.certificateToPem(certForge)).digest().toHex();
  return fingerprint.match(/.{2}/g)?.join(':').toUpperCase() || fingerprint;
}
