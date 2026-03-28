#!/bin/bash
set -e

BIN_LINK="/usr/local/bin/cmd0"
PLIST_NAME="com.cmd0.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "Uninstalling cmd0..."

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "-> Removed launch agent"
fi

if [ -L "$BIN_LINK" ]; then
  sudo rm "$BIN_LINK"
  echo "-> Removed $BIN_LINK"
fi

APP_DIR="/Applications/cmd0.app"
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR"
  echo "-> Removed $APP_DIR"
fi

echo ""
echo "Done. cmd0 is uninstalled."
echo "Your data is still at ~/.cmd0/ — delete it manually if you want."
