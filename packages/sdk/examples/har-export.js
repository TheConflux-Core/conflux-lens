const { createProxyServer } = require('../dist/index.js');
const fs = require('fs');

async function main() {
  console.log('Starting proxy with HAR export...\n');

  const proxy = createProxyServer({
    port: 9877,
    logLevel: 'info',
    autoConfigureTrust: false,
  });

  await proxy.start();
  console.log('Proxy running on port 9877\n');
  console.log('Make some requests through the proxy...\n');

  setTimeout(async () => {
    console.log('Exporting HAR file...\n');
    const har = proxy.exportHar();
    fs.writeFileSync('capture.har', JSON.stringify(har, null, 2));
    console.log(`Exported ${har.entries.length} entries to capture.har`);

    await proxy.stop();
    console.log('Done');
    process.exit(0);
  }, 15000);
}

main().catch(console.error);
