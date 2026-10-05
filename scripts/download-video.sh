#!/usr/bin/env bash
# Downloads the Bad Apple!! PV from YouTube to work/bad-apple.<ext>, the
# working file build-assets.sh reads. Skips the download when it is there.
# Needs: yt-dlp (or uvx, which runs the latest yt-dlp).
# Usage: scripts/download-video.sh [url] [--force]
set -euo pipefail

URL="https://www.youtube.com/watch?v=FtutLA63Cp8"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) URL="$arg" ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/work"
mkdir -p "$WORK"

existing="$(ls "$WORK"/bad-apple.* 2>/dev/null | head -1 || true)"
if [[ -n "$existing" && "$FORCE" == 0 ]]; then
  echo "$existing"
  exit 0
fi
rm -f "$WORK"/bad-apple.*

# uvx gets the newest yt-dlp: YouTube often breaks older releases (HTTP 403).
if command -v uvx >/dev/null; then YTDLP=(uvx yt-dlp@latest); else YTDLP=(yt-dlp); fi

echo "Downloading $URL ..." >&2
"${YTDLP[@]}" -q --no-warnings --no-playlist \
  -f "bv*[height<=480]+ba/b[height<=480]" \
  -o "$WORK/bad-apple.%(ext)s" "$URL" >&2
ls "$WORK"/bad-apple.* | head -1
