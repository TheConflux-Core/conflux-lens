import * as fs from 'fs';
import { CA_CERT_PATH } from '../cert-manager';

/**
 * Trust store helper - configures Node.js to trust the custom CA certificate.
 */
export class TrustStore {
  /**
   * Check if Node.js is already configured to trust our CA.
   */
  static isAlreadyConfigured(): boolean {
    const extraCerts = process.env.NODE_EXTRA_CA_CERTS;
    if (!extraCerts) {
      return false;
    }

    try {
      // Check if the specified file exists and matches our CA cert
      const content = fs.readFileSync(extraCerts, 'utf8');
      const ours = fs.readFileSync(CA_CERT_PATH, 'utf8');
      return content === ours;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get the setup command for manual configuration.
   */
  static getSetupCommand(): string {
    if (process.platform === 'win32') {
      return `$env:NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"`;
    }
    return `export NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"`;
  }

  /**
   * Get the setup command for persistent configuration (in shell RC files).
   */
  static getPersistentSetupCommand(): string {
    if (process.platform === 'win32') {
      return `[System.Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', '${CA_CERT_PATH}', 'User')`;
    }
    const shell = process.env.SHELL || '';
    if (shell.includes('zsh')) {
      return `echo 'export NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"' >> ~/.zshrc`;
    } else if (shell.includes('bash')) {
      return `echo 'export NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"' >> ~/.bashrc`;
    } else {
      return `echo 'export NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"' >> ~/.profile`;
    }
  }

  /**
   * Print setup instructions to the console.
   */
  static printSetupInstructions(): void {
    console.log('\n\ud83d\udd10 HTTPS Interception Setup');
    console.log('='.repeat(50));
    console.log('\nTo enable HTTPS interception for Node.js applications,');
    console.log('configure Node.js to trust the CA certificate:\n');
    console.log(`  ${this.getSetupCommand()}\n`);
    console.log('For persistent configuration (across sessions):\n');
    console.log(`  ${this.getPersistentSetupCommand()}\n`);
    console.log('After setting this variable, restart your Node.js applications.');
    console.log('The proxy will then be able to decrypt and inspect HTTPS traffic.');
    console.log('\nNote: Non-Node.js applications (Python, etc.) need their own');
    console.log('trust store configuration to use this CA certificate.');
    console.log('='.repeat(50) + '\n');
  }

  /**
   * Try to auto-configure NODE_EXTRA_CA_CERTS by setting the env var.
   * Returns true if successful (or already configured).
   * Note: This only affects the current process.
   */
  static autoConfigure(): boolean {
    if (this.isAlreadyConfigured()) {
      return true;
    }

    if (!fs.existsSync(CA_CERT_PATH)) {
      return false;
    }

    process.env.NODE_EXTRA_CA_CERTS = CA_CERT_PATH;
    return true;
  }

  /**
   * Check if Node.js built-in TLS would trust our CA.
   */
  static checkTrust(): { configured: boolean; message: string } {
    const extraCerts = process.env.NODE_EXTRA_CA_CERTS;

    if (!extraCerts) {
      return {
        configured: false,
        message: 'NODE_EXTRA_CA_CERTS is not set. HTTPS interception will not work for Node.js apps.'
      };
    }

    if (!fs.existsSync(extraCerts)) {
      return {
        configured: false,
        message: `CA certificate file not found: ${extraCerts}`
      };
    }

    try {
      const content = fs.readFileSync(extraCerts, 'utf8');
      const ours = fs.readFileSync(CA_CERT_PATH, 'utf8');
      if (content === ours) {
        return {
          configured: true,
          message: 'CA certificate is properly configured for Node.js HTTPS interception.'
        };
      }
      return {
        configured: false,
        message: 'NODE_EXTRA_CA_CERTS points to a different CA certificate.'
      };
    } catch (err: any) {
      return {
        configured: false,
        message: `Error reading CA certificate: ${err.message}`
      };
    }
  }
}

/**
 * Re-export checkTrust as a top-level function for backwards compatibility.
 */
export const checkTrust = TrustStore.checkTrust;
