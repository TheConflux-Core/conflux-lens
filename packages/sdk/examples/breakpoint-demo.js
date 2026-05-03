const { createProxyServer } = require('../dist/index.js');

async function main() {
  console.log('Breakpoint Demo\n');

  const proxy = createProxyServer({
    port: 9878,
    logLevel: 'verbose',
    autoConfigureTrust: false,
  });

  await proxy.start();
  console.log('Proxy running on port 9878\n');

  proxy.addBreakpoint({
    type: 'request',
    match: {
      method: 'POST',
      urlPattern: '/api',
    },
    enabled: true,
  });

  console.log('Breakpoint added: POST /api\n');
  console.log('Make a POST request to http://localhost:9878/api/test');
  console.log('The request will pause and wait for manual resume.\n');

  setTimeout(async () => {
    await proxy.stop();
    console.log('\nStopped');
    process.exit(0);
  }, 30000);
}

main().catch(console.error);
