#!/bin/bash

# Development script for the alpaca-bonsai webui
#
# This script starts the webui development servers (Storybook and Vite).
# Note: You need to start the Alpaca desktop app (or llama-server) separately.
#
# Usage:
#   bash scripts/dev.sh
#   npm run dev
#
# Layout (alpaca-bonsai):
#   alpaca-bonsai/
#     webui/          <- this script lives in webui/scripts/
#     desktop/        <- Electron main process + API gateway on port 13439
#     tui/            <- Terminal UI (Rust)
#
# The Vite dev server proxies /v1/* to the desktop API gateway on 127.0.0.1:13439
# so the standalone webui can use the DesktopService HTTP fallback for model
# management (see src/lib/services/desktop.service.ts).

# Run from the webui/ directory regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up..."
    exit
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "🚀 Starting development servers..."
echo "📝 Note: Make sure to start the Alpaca desktop app (or llama-server) separately"
echo "📝 The desktop API gateway runs on 127.0.0.1:13439"

# Use --insecure-http-parser to handle malformed HTTP responses from llama-server
# (some responses have both Content-Length and Transfer-Encoding headers)
storybook dev -p 6006 --ci & NODE_OPTIONS="--insecure-http-parser" vite dev --host 0.0.0.0 &

# Wait for all background processes
wait
