#!/bin/bash
set -e

OS="$(uname -s)"

echo "Uninstalling cmd0..."

if [ "$OS" = "Darwin" ]; then
  # --- macOS ---
  PLIST_PATH="$HOME/Library/LaunchAgents/com.cmd0.agent.plist"
  BIN_LINK="/usr/local/bin/cmd0"
  APP_DIR="/Applications/cmd0.app"

  if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm "$PLIST_PATH"
    echo "-> Removed launch agent"
  fi

  if [ -L "$BIN_LINK" ]; then
    sudo rm "$BIN_LINK"
    echo "-> Removed $BIN_LINK"
  fi

  if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    echo "-> Removed $APP_DIR"
  fi

else
  # --- Linux ---
  BIN_LINK="$HOME/.local/bin/cmd0"
  DESKTOP_FILE="$HOME/.local/share/applications/cmd0.desktop"
  SERVICE_FILE="$HOME/.config/systemd/user/cmd0.service"

  if [ -f "$SERVICE_FILE" ]; then
    systemctl --user disable cmd0.service 2>/dev/null || true
    systemctl --user stop cmd0.service 2>/dev/null || true
    rm "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "-> Removed systemd service"
  fi

  if [ -L "$BIN_LINK" ] || [ -f "$BIN_LINK" ]; then
    rm "$BIN_LINK"
    echo "-> Removed $BIN_LINK"
  fi

  if [ -f "$DESKTOP_FILE" ]; then
    rm "$DESKTOP_FILE"
    echo "-> Removed desktop entry"
  fi

  HYPR_CONF="$HOME/.config/hypr/hyprland.conf"
  if [ -f "$HYPR_CONF" ] && grep -q 'cmd0' "$HYPR_CONF"; then
    sed -i '/^# cmd0$/d; /cmd0/d' "$HYPR_CONF"
    # clean up leftover blank lines
    sed -i '/^$/N;/^\n$/d' "$HYPR_CONF"
    echo "-> Removed Hyprland config entries"
  fi
fi

echo ""
echo "Done. cmd0 is uninstalled."
echo "Your data is still at ~/.cmd0/ — delete it manually if you want."
