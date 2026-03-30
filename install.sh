#!/bin/bash
set -e

CMD0_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(dirname "$(which node)")"
OS="$(uname -s)"

echo "Installing cmd0 from $CMD0_DIR"

echo "-> Installing dependencies..."
cd "$CMD0_DIR"
npm install --no-fund --no-audit 2>&1 | tail -1

echo "-> Building..."
npx tsc

echo "-> Creating launcher..."
if [ "$OS" = "Darwin" ]; then
  cat > "$CMD0_DIR/cmd0-launcher.sh" << 'LAUNCHER'
#!/bin/bash
cd "CMD0_DIR_PLACEHOLDER"
export PATH="NODE_BIN_PLACEHOLDER:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"

CMD0_PID="$HOME/.cmd0/pid"

case "$*" in
  *--help*|-h)
    echo "Usage: cmd0 [options]"
    echo ""
    echo "Options:"
    echo "  --safe              Start in safe mode (restore base files)"
    echo "  --snap <name>       Save a snapshot"
    echo "  --restore <name>    Restore a snapshot"
    echo "  -h, --help          Show this help"
    exit 0
    ;;
  *--snap*|*--restore*)
    exec npx electron . "$@"
    ;;
  *)
    if [ -f "$CMD0_PID" ] && kill -0 "$(cat "$CMD0_PID")" 2>/dev/null; then
      kill -USR2 "$(cat "$CMD0_PID")"
    else
      npx electron . "$@" &
      disown
    fi
    ;;
esac
LAUNCHER
  sed -i'' -e "s|CMD0_DIR_PLACEHOLDER|$CMD0_DIR|g" -e "s|NODE_BIN_PLACEHOLDER|$NODE_BIN|g" "$CMD0_DIR/cmd0-launcher.sh"
else
  cat > "$CMD0_DIR/cmd0-launcher.sh" << 'LAUNCHER'
#!/bin/bash
cd "CMD0_DIR_PLACEHOLDER"
export PATH="NODE_BIN_PLACEHOLDER:$PATH"

CMD0_PID="$HOME/.cmd0/pid"

case "$*" in
  *--help*|-h)
    echo "Usage: cmd0 [options]"
    echo ""
    echo "Options:"
    echo "  --safe              Start in safe mode (restore base files)"
    echo "  --snap <name>       Save a snapshot"
    echo "  --restore <name>    Restore a snapshot"
    echo "  -h, --help          Show this help"
    exit 0
    ;;
  *--snap*|*--restore*)
    exec npx electron . "$@"
    ;;
  *)
    if [ -f "$CMD0_PID" ] && kill -0 "$(cat "$CMD0_PID")" 2>/dev/null; then
      kill -USR2 "$(cat "$CMD0_PID")"
    else
      npx electron . "$@" &
      disown
    fi
    ;;
esac
LAUNCHER
  sed -i'' -e "s|CMD0_DIR_PLACEHOLDER|$CMD0_DIR|g" -e "s|NODE_BIN_PLACEHOLDER|$NODE_BIN|g" "$CMD0_DIR/cmd0-launcher.sh"
fi
chmod +x "$CMD0_DIR/cmd0-launcher.sh"

if [ "$OS" = "Darwin" ]; then
  # --- macOS ---
  BIN_LINK="/usr/local/bin/cmd0"
  PLIST_NAME="com.cmd0.agent"
  PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

  echo "-> Linking cmd0 to $BIN_LINK..."
  if [ -L "$BIN_LINK" ] || [ -f "$BIN_LINK" ]; then
    sudo rm "$BIN_LINK"
  fi
  sudo ln -s "$CMD0_DIR/cmd0-launcher.sh" "$BIN_LINK"

  echo "-> Setting up launch agent..."
  cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CMD0_DIR/cmd0-launcher.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_BIN:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
EOF

  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load "$PLIST_PATH"

  echo "-> Creating macOS app bundle..."
  APP_DIR="/Applications/cmd0.app"
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR/Contents/MacOS"
  mkdir -p "$APP_DIR/Contents/Resources"

  cat > "$APP_DIR/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>cmd0</string>
  <key>CFBundleDisplayName</key>
  <string>cmd0</string>
  <key>CFBundleIdentifier</key>
  <string>com.cmd0.agent</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>cmd0</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

  cat > "$APP_DIR/Contents/MacOS/cmd0" << EOF
#!/bin/bash
cd "$CMD0_DIR"
export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH"
exec npx electron . "\$@"
EOF
  chmod +x "$APP_DIR/Contents/MacOS/cmd0"

  if [ -f "$CMD0_DIR/icon.icns" ]; then
    cp "$CMD0_DIR/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"
  elif [ -f "$CMD0_DIR/icon.png" ]; then
    echo "-> Converting icon.png to icon.icns..."
    ICONSET_DIR=$(mktemp -d)/icon.iconset
    mkdir -p "$ICONSET_DIR"
    for size in 16 32 64 128 256 512; do
      sips -z $size $size "$CMD0_DIR/icon.png" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null 2>&1
    done
    for size in 32 64 256 512 1024; do
      half=$((size / 2))
      sips -z $size $size "$CMD0_DIR/icon.png" --out "$ICONSET_DIR/icon_${half}x${half}@2x.png" >/dev/null 2>&1
    done
    iconutil -c icns "$ICONSET_DIR" -o "$APP_DIR/Contents/Resources/icon.icns"
    rm -rf "$(dirname "$ICONSET_DIR")"
  fi

  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR"

  echo ""
  echo "Done! cmd0 is installed."
  echo "  - Run:        cmd0"
  echo "  - Safe mode:  cmd0 --safe"
  echo "  - Toggle:     Cmd+0"
  echo "  - Spotlight:  search 'cmd0'"
  echo "  - Starts automatically on login"
  echo ""
  echo "To uninstall: bash $CMD0_DIR/uninstall.sh"

else
  # --- Linux ---
  BIN_DIR="$HOME/.local/bin"
  BIN_LINK="$BIN_DIR/cmd0"

  mkdir -p "$BIN_DIR"
  echo "-> Linking cmd0 to $BIN_LINK..."
  ln -sf "$CMD0_DIR/cmd0-launcher.sh" "$BIN_LINK"

  echo "-> Creating .desktop entry..."
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat > "$DESKTOP_DIR/cmd0.desktop" << EOF
[Desktop Entry]
Name=cmd0
Comment=Desktop AI agent
Exec=$CMD0_DIR/cmd0-launcher.sh
Icon=$CMD0_DIR/icon.png
Terminal=false
Type=Application
Categories=Utility;
StartupWMClass=cmd0
EOF

  echo "-> Setting up systemd autostart..."
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SYSTEMD_DIR"
  cat > "$SYSTEMD_DIR/cmd0.service" << EOF
[Unit]
Description=cmd0 desktop AI agent
After=graphical-session.target

[Service]
Type=simple
ExecStart=$CMD0_DIR/cmd0-launcher.sh
Restart=on-failure
RestartSec=5
Environment=PATH=$NODE_BIN:/usr/local/bin:/usr/bin:/bin
Environment=DISPLAY=:0

[Install]
WantedBy=graphical-session.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable cmd0.service

  # --- Hyprland config ---
  HYPR_CONF="$HOME/.config/hypr/hyprland.conf"
  if [ -f "$HYPR_CONF" ]; then
    if ! grep -q 'cmd0' "$HYPR_CONF"; then
      echo "-> Adding Hyprland keybind and window rules..."
      cat >> "$HYPR_CONF" << 'EOF'

# cmd0
bind = SUPER, minus, exec, $BIN_LINK
windowrule = match:class cmd0, float on
windowrule = match:class cmd0, pin on
windowrule = match:class cmd0, decorate off
windowrule = match:class cmd0, border_size 0
EOF
    else
      echo "-> Hyprland config already has cmd0 entries, skipping"
    fi
  fi

  echo ""
  echo "Done! cmd0 is installed."
  echo "  - Run:        cmd0"
  echo "  - Safe mode:  cmd0 --safe"
  echo "  - Toggle:     Super+0"
  echo "  - Starts automatically on login via systemd"
  echo ""
  echo "Recommended packages: grim slurp libnotify wl-clipboard"
  echo ""
  echo "To uninstall: bash $CMD0_DIR/uninstall.sh"
fi
