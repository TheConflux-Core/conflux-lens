import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain'
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function serveDashboard(port: number): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const baseDir = path.join(__dirname, '..', '..', 'dist', 'dashboard');
        let reqPath = req.url === '/' ? '/index.html' : req.url || '/index.html';
        if (reqPath.includes('..')) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        const filePath = path.join(baseDir, reqPath);
        
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const contentType = getContentType(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end('Server Error');
      }
    });

    server.listen(port, () => {
      resolve();
    });
  });
}
