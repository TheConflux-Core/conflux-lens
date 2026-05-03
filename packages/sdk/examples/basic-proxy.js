const { createProxyServer } = require('../dist/index.js');

async function main() {
  console.log('Starting basic proxy...\n');

  const proxy = createProxyServer({
    port: 9876,
    logLevel: 'info',
    autoConfigureTrust: false,
  });

  await proxy.start();
  console.log('Proxy running on port 9876\n');

  setTimeout(async () => {
    console.log('Stopping proxy...');
    await proxy.stop();
    console.log('Done');
    process.exit(0);
  }, 10000);
}

main().catch(console.error);
