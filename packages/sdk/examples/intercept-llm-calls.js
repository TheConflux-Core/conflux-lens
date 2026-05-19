const { createInterceptor } = require('../dist/index.js');

console.log('Setting up LLM API call interceptor...\n');

const interceptor = createInterceptor({
  target: 'all',
  captureBody: true,
  maxBodySize: 100000,
  onRequest: (context) => {
    const { request } = context;
    if (request.url.includes('openai.com') || request.url.includes('anthropic.com')) {
      console.log('\n=== LLM API Request ===');
      console.log(`Method: ${request.method}`);
      console.log(`URL: ${request.url}`);
      if (request.body) {
        console.log(`Body: ${request.body}`);
      }
    }
  },
  onResponse: (context) => {
    const { request, response } = context;
    if (request.url.includes('openai.com') || request.url.includes('anthropic.com')) {
      console.log(`\n=== LLM API Response ===`);
      console.log(`Status: ${response.statusCode}`);
      console.log(`Duration: ${response.duration}ms`);
      if (response.body) {
        console.log(`Body: ${response.body.substring(0, 500)}...`);
      }
      console.log('');
    }
  },
});

console.log('Interceptor enabled. Monitoring LLM API calls...\n');
console.log('Make some HTTP requests to see them captured.\n');
console.log('Press Ctrl+C to exit.\n');
