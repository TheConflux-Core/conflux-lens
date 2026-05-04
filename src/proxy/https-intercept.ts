/**
 * HTTPS Interception Module
 * 
 * This module is now DEPRECATED.
 * The MITM logic has been moved directly into `packages/sdk/src/proxy-server.ts`
 * in the `handleHttpsConnect` method.
 * 
 * The current implementation in proxy-server.ts properly:
 * 1. Generates certificates for target hostnames (signed by Conflux Lens CA)
 * 2. Terminates client TLS using the generated certificate (decrypts)
 * 3. Establishes separate TLS connection to upstream server
 * 4. Pipes decrypted data between client and upstream (with capture)
 * 
 * This file is kept as a placeholder for documentation purposes.
 * See: packages/sdk/src/proxy-server.ts -> handleHttpsConnect()
 */

export function httpsInterceptDeprecated(): void {
  console.warn('https-intercept.ts is deprecated. MITM is now in proxy-server.ts');
}
