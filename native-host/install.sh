#!/usr/bin/env bash
# Installs the Sieve native messaging host for Chrome / Arc / Dia on macOS.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="$DIR/sieve-downloader.py"
chmod +x "$HOST"

echo "Enter your Sieve extension ID (from chrome://extensions or the browser's extension page):"
read -r EXT_ID

if [ -z "$EXT_ID" ]; then
  echo "No extension ID provided — aborting." >&2
  exit 1
fi

write_manifest() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<EOF
{
  "name": "com.sieve.downloader",
  "description": "Sieve audio downloader — yt-dlp bridge",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "✓ Installed at $dest"
}

# Chrome
write_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sieve.downloader.json"

# Chrome Canary
if [ -d "$HOME/Library/Application Support/Google/Chrome Canary" ]; then
  write_manifest "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts/com.sieve.downloader.json"
fi

# Arc
if [ -d "$HOME/Library/Application Support/Arc" ]; then
  write_manifest "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts/com.sieve.downloader.json"
fi

# Dia (uses Chromium data dir)
if [ -d "$HOME/Library/Application Support/Dia" ]; then
  write_manifest "$HOME/Library/Application Support/Dia/NativeMessagingHosts/com.sieve.downloader.json"
fi

echo ""
echo "Make sure yt-dlp is installed:  brew install yt-dlp"
echo "Then reload Sieve in your browser's extension page."
