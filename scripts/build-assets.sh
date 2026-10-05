#!/usr/bin/env bash
# Builds assets/ (1-bit frames + mp3) from the Bad Apple!! PV.
# Needs: ffmpeg, python3, and for the download yt-dlp (or uvx).
# Usage: scripts/build-assets.sh [url] [--force]  (passed to download-video.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

VIDEO="$("$ROOT/scripts/download-video.sh" "$@")"
echo "Using $VIDEO"

echo "Extracting frames and audio..."
ffmpeg -v error -y -i "$VIDEO" -vf "fps=30,scale=192:144:flags=area,format=gray" -f rawvideo "$WORK/gray.raw"
mkdir -p "$ASSETS"
rm -f "$ASSETS"/frames-*.bin
# Constant 96 kbit/s: the mod seeks by byte offset (12000 bytes a second).
ffmpeg -v error -y -i "$VIDEO" -vn -ac 1 -c:a libmp3lame -b:a 96k "$ASSETS/bad-apple.mp3"

echo "Packing frames..."
python3 - "$WORK/gray.raw" "$ASSETS" <<'PY'
import json, sys
src, out_dir = sys.argv[1], sys.argv[2]
W, H, FPS, PER = 192, 144, 30, 1000
size = W * H
data = open(src, 'rb').read()
frames = len(data) // size
packed = bytearray()
for i in range(frames):
    byte = bits = 0
    for p in data[i * size:(i + 1) * size]:
        byte = (byte << 1) | (p >= 128)
        bits += 1
        if bits == 8:
            packed.append(byte)
            byte = bits = 0
fb = size // 8
chunks = 0
for start in range(0, frames, PER):
    with open(f'{out_dir}/frames-{chunks}.bin', 'wb') as f:
        f.write(packed[start * fb:min(frames, start + PER) * fb])
    chunks += 1
json.dump({'width': W, 'height': H, 'fps': FPS, 'frames': frames,
           'framesPerChunk': PER, 'chunks': chunks}, open(f'{out_dir}/meta.json', 'w'))
print(f'{frames} frames in {chunks} chunks')
PY
echo "Done: $ASSETS"
