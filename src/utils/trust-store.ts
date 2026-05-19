import * as fs from 'fs';
import * as os from 'os';
import { CA_CERT_PATH as UNIX_CA_PATH } from '../cert-manager';

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

    const caPath = this.getCACertPath();
    
    try {
      // Check if the specified file exists and matches our CA cert
      const content = fs.readFileSync(extraCerts, 'utf8');
      const ours = fs.readFileSync(caPath, 'utf8');
      return content === ours;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get the platform-appropriate CA cert path.
   */
  static getCACertPath(): string {
    if (process.platform === 'win32') {
      // Windows: use USERPROFILE environment variable
      const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
      return `${userProfile}\\.conflux-lens\\ca.pem`;
    }
    return UNIX_CA_PATH;
  }

  /**
   * Get the setup command for manual configuration.
   */
  static getSetupCommand(): string {
    const caPath = this.getCACertPath();
    if (process.platform === 'win32') {
      return `$env:NODE_EXTRA_CA_CERTS="${caPath}"`;
    }
    return `export NODE_EXTRA_CA_CERTS="${caPath}"`;
  }

  /**
   * Get the setup command for persistent configuration (in shell RC files).
   */
  static getPersistentSetupCommand(): string {
    const caPath = this.getCACertPath();
    if (process.platform === 'win32') {
      return `[System.Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', '${caPath}', 'User')`;
    }
    const shell = process.env.SHELL || '';
    if (shell.includes('zsh')) {
      return `echo 'export NODE_EXTRA_CA_CERTS="${caPath}"' >> ~/.zshrc`;
    } else if (shell.includes('bash')) {
      return `echo 'export NODE_EXTRA_CA_CERTS="${caPath}"' >> ~/.bashrc`;
    } else {
      return `echo 'export NODE_EXTRA_CA_CERTS="${caPath}"' >> ~/.profile`;
    }
  }

  /**
   * Print setup instructions to the console.
   */
  static printSetupInstructions(): void {
    const caPath = this.getCACertPath();
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

    const caPath = this.getCACertPath();
    if (!fs.existsSync(caPath)) {
      return false;
    }

    process.env.NODE_EXTRA_CA_CERTS = caPath;
    return true;
  }

  /**
   * Check if Node.js built-in TLS would trust our CA.
   */
  static checkTrust(): { configured: boolean; message: string } {
    const caPath = this.getCACertPath();
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

    if (!fs.existsSync(caPath)) {
      return {
        configured: false,
        message: `Our CA certificate not found: ${caPath}`
      };
    }

    try {
      const content = fs.readFileSync(extraCerts, 'utf8');
      const ours = fs.readFileSync(caPath, 'utf8');
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
