#!/bin/bash
set -e

CMD0_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_LINK="/usr/local/bin/cmd0"
PLIST_NAME="com.cmd0.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
NODE_BIN="$(dirname "$(which node)")"

echo "Installing cmd0 from $CMD0_DIR"

echo "-> Installing dependencies..."
cd "$CMD0_DIR"
npm install --no-fund --no-audit 2>&1 | tail -1

echo "-> Building..."
npx tsc

echo "-> Creating launcher..."
cat > "$CMD0_DIR/cmd0-launcher.sh" << EOF
#!/bin/bash
cd "$CMD0_DIR"
export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH"
npx electron . "\$@" &
disown
EOF
chmod +x "$CMD0_DIR/cmd0-launcher.sh"

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
