#!/usr/bin/env node
/**
 * Cross-platform script to copy dashboard static files to dist/
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'dashboard');
const dst = path.join(__dirname, '..', 'dist', 'dashboard');

// Ensure destination directory exists
fs.mkdirSync(dst, { recursive: true });

// Copy all files from src to dst
const files = fs.readdirSync(src);
for (const file of files) {
  const srcFile = path.join(src, file);
  const dstFile = path.join(dst, file);
  fs.copyFileSync(srcFile, dstFile);
  console.log(`  Copied: ${file}`);
}

console.log(`\nDashboard files copied to ${dst}`);
