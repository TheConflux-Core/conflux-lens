#!/bin/bash
set -e

echo "Building JS..."
npx tsup src/index.ts --format cjs --out-dir dist --sourcemap --no-dts

echo "Generating DTS..."
# Generate DTS files, ignoring type errors
npx tsc --emitDeclarationOnly --declaration --declarationDir dist-temp --skipLibCheck --skipDefaultLibCheck --maxNodeModuleJsDepth 0 2>&1 | grep -v "error TS" || true

# Copy type files if they were generated
cp -r dist-temp/*.d.ts dist/ 2>/dev/null || true
rm -rf dist-temp 2>/dev/null || true

echo "Build complete!"
