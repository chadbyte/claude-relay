#!/bin/bash
# Install Clay MCP Bridge Native Messaging Host
# Usage: ./install.sh [extension-id]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/clay-mcp-host.js"
EXT_ID="${1:-__EXTENSION_ID__}"

if [ ! -f "$HOST_SCRIPT" ]; then
  echo "Error: clay-mcp-host.js not found in $SCRIPT_DIR"
  exit 1
fi

chmod +x "$HOST_SCRIPT"

# Determine target directory
case "$(uname -s)" in
  Darwin)
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)"
    echo "For Windows, manually add the registry key."
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"

# Write manifest with resolved paths
cat > "$TARGET_DIR/com.clay.mcp_bridge.json" << EOF
{
  "name": "com.clay.mcp_bridge",
  "description": "Clay MCP Bridge - Manages local MCP server processes",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "Installed native messaging host manifest to:"
echo "  $TARGET_DIR/com.clay.mcp_bridge.json"
echo ""
echo "Host script: $HOST_SCRIPT"
echo "Extension ID: $EXT_ID"
echo ""
echo "Done."
