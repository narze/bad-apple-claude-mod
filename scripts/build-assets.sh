#!/usr/bin/env bash
# Builds assets/ (1-bit frames + mp3) from the Bad Apple!! PV.
# Needs: yt-dlp (or uvx), ffmpeg, python3.
set -euo pipefail

URL="${1:-https://www.youtube.com/watch?v=FtutLA63Cp8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if command -v uvx >/dev/null; then YTDLP=(uvx yt-dlp@latest); else YTDLP=(yt-dlp); fi

echo "Downloading video..."
"${YTDLP[@]}" -q --no-warnings -f "bv*[height<=480]+ba/b[height<=480]" -o "$WORK/video.%(ext)s" "$URL"
VIDEO="$(ls "$WORK"/video.*)"

echo "Extracting frames and audio..."
ffmpeg -v error -y -i "$VIDEO" -vf "fps=30,scale=96:72:flags=area,format=gray" -f rawvideo "$WORK/gray.raw"
mkdir -p "$ASSETS"
# Constant 96 kbit/s: the mod seeks by byte offset (12000 bytes a second).
ffmpeg -v error -y -i "$VIDEO" -vn -ac 1 -c:a libmp3lame -b:a 96k "$ASSETS/bad-apple.mp3"

echo "Packing frames..."
python3 - "$WORK/gray.raw" "$ASSETS" <<'PY'
import json, sys
src, out_dir = sys.argv[1], sys.argv[2]
W, H, FPS, PER = 96, 72, 30, 1800
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
