#!/bin/bash
# EAS pre-install hook script to remove unused modules
# This script runs before npm install on EAS Build

set -e

echo "🧹 Cleaning up unused modules for mobile build..."

# Define the modules to remove
UNUSED_MODULES=(
  "onnxruntime-node"
  "onnxruntime-web"
  "@pagefind"
  "pdfjs-dist"
  "typescript"
  "esbuild"
  "@biomejs"
  "react-devtools-core"
)

# Navigate to monorepo root
cd "$(dirname "$0")/../.."

for module in "${UNUSED_MODULES[@]}"; do
  if [ -d "node_modules/$module" ]; then
    echo "  Removing $module..."
    rm -rf "node_modules/$module"
  fi
done

echo "✅ Cleanup complete!"
