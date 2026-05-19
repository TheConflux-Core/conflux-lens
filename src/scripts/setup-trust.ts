#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadOrCreateRootCA, CA_CERT_PATH as UNIX_CA_PATH, getCAFingerprint } from '../cert-manager';
import { TrustStore } from '../utils/trust-store';

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`
Conflux Lens - HTTPS Interception Setup
==========================================

Usage: npm run setup-trust [command]

Commands:
  setup          Generate CA cert and print setup instructions
  verify         Check if Node.js trust is configured
  auto-configure Set NODE_EXTRA_CA_CERTS for this session
  fingerprint    Show CA certificate fingerprint
  help           Show this help message

Examples:
  npm run setup-trust setup
  npm run setup-trust verify
  npm run setup-trust auto-configure
`);
}

function main(): void {
  const command = args[0] || 'help';

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    case 'setup': {
      console.log('\n🚀 Setting up HTTPS Interception...\n');
      
      // Generate or load CA
      const { cert } = loadOrCreateRootCA();
      
      // Print fingerprint
      console.log(`   CA Fingerprint: ${getCAFingerprint()}\n`);
      
      // Print platform-specific path
      const caPath = TrustStore.getCACertPath();
      console.log(`   CA Path: ${caPath}\n`);
      
      // Print instructions
      console.log('\n📝 Next Steps:');
      console.log('\n1. Configure Node.js to trust this CA:');
      console.log(`   ${TrustStore.getSetupCommand()}`);
      console.log('\n2. For persistent configuration (recommended):');
      console.log(`   ${TrustStore.getPersistentSetupCommand()}`);
      console.log('\n3. Then restart your Node.js applications.');
      console.log('\n✅ Setup complete! Your proxy can now intercept HTTPS traffic.\n');
      
      break;
    }

    case 'verify': {
      console.log('\n🔍 Verifying HTTPS Interception Configuration\n');
      console.log('='.repeat(50));
      
      const caPath = TrustStore.getCACertPath();
      
      // Check CA cert exists
      const caExists = fs.existsSync(caPath);
      console.log(`\nCA Certificate: ${caExists ? '✅ Found' : '❌ Not found'}`);
      if (caExists) {
        console.log(`   Path: ${caPath}`);
        console.log(`   Fingerprint: ${getCAFingerprint()}`);
      }
      
      // Check trust configuration
      const trustInfo = TrustStore.checkTrust();
      console.log(`\nNode.js Trust: ${trustInfo.configured ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`   ${trustInfo.message}`);
      
      if (!trustInfo.configured) {
        console.log(`\n💡 Run \`npm run setup-trust auto-configure\` to configure for this session.`);
        console.log(`   Run \`${TrustStore.getSetupCommand()}\` to configure manually.`);
      }
      
      console.log('\n' + '='.repeat(50) + '\n');
      break;
    }

    case 'auto-configure': {
      console.log('\n⚙️  Auto-configuring NODE_EXTRA_CA_CERTS...\n');
      
      const caPath = TrustStore.getCACertPath();
      
      if (!fs.existsSync(caPath)) {
        console.log(`❌ CA certificate not found. Run \`npm run setup-trust setup\` first.\n`);
        process.exit(1);
      }
      
      process.env.NODE_EXTRA_CA_CERTS = caPath;
      const trustInfo = TrustStore.checkTrust();
      
      if (trustInfo.configured) {
        console.log('✅ NODE_EXTRA_CA_CERTS configured for this session.');
        console.log(`   Value: ${caPath}\n`);
        console.log('   Note: This only affects the current process.');
        console.log('   Run `npm run setup-trust verify` to verify.\n');
      } else {
        console.log('❌ Configuration failed.');
        console.log(`   ${trustInfo.message}\n`);
        process.exit(1);
      }
      break;
    }

    case 'fingerprint': {
      const caPath = TrustStore.getCACertPath();
      
      if (!fs.existsSync(caPath)) {
        console.log(`❌ CA certificate not found. Run \`npm run setup-trust setup\` first.\n`);
        process.exit(1);
      }
      console.log(`\nCA Certificate Fingerprint (SHA256):\n`);
      console.log(`  ${getCAFingerprint()}\n`);
      console.log(`  Path: ${caPath}\n`);
      break;
    }

    default:
      console.log(`\n❌ Unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}

main();
