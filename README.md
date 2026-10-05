# bad-apple-claude-mod

Plays **Bad Apple!!** inside Claude Code, as a mod (a plugin of function hooks).
The video plays in the band above the prompt, or in a side pane, with the song in sync.

- Antialiased quadrant cells: each cell is a solid quadrant glyph (`▘▀▌▙█…`) over 2x2 quarters with two of 32 gray levels, the best two-tone fit to how much of each quarter is lit; all drawn as one `Raster`
- 192x144 frames into at most 96x36 cells; smaller sites average bigger pixel blocks, never upscale
- About 60 repaints a second with `$.ui.blit`, frame picked from the wall clock so video stays in sync with the song
- Pause and resume, also for the song (the mod cuts the constant-bitrate MP3 at the right byte)
- Time and a progress bar beside the video, and in the status line

## Use

| Command | What it does |
| --- | --- |
| `/bad-apple` | Play in the band above the prompt (default) |
| `/bad-apple pane` | Play in a pane (Esc closes it) |
| `/bad-apple pause` / `resume` | Pause or resume |
| `/bad-apple restart` | Play again from 0:00, in the same place |
| `/bad-apple stop` | Stop |

The band has **Pause/Resume** (`p`), **Restart** (`r`) and **Stop** (`s`) buttons; the pane has Pause/Resume and Restart.

Sound plays through `afplay`, so only on macOS. Other systems get the video only.

## Install

The video frames and the song are not in this repo. Build them on your machine.
You need `ffmpeg`, `python3`, and `yt-dlp` (or `uvx`, which runs the latest `yt-dlp`).

```sh
git clone https://github.com/narze/bad-apple-claude-mod
cd bad-apple-claude-mod
./scripts/download-video.sh   # yt-dlp: YouTube -> work/bad-apple.webm
./scripts/build-assets.sh     # work file -> assets/
claude --plugin-dir "$PWD"
```

### Scripts

| Script | What it does |
| --- | --- |
| `scripts/download-video.sh [url] [--force]` | Downloads the PV from YouTube with `yt-dlp` (480p or less) to the working file `work/bad-apple.<ext>`. Skips the download when the file is there; `--force` downloads again. Default URL: `https://www.youtube.com/watch?v=FtutLA63Cp8` |
| `scripts/build-assets.sh [url] [--force]` | Runs `download-video.sh` (same arguments), then makes 192x144 1-bit frames at 30 fps in `assets/frames-*.bin` and a 96 kbit/s mono MP3 in `assets/bad-apple.mp3` |

If YouTube refuses the download (`HTTP Error 403`), update `yt-dlp`, or install `uv` so the script uses `uvx yt-dlp@latest`.
`work/` and `assets/` are git-ignored.

## Develop

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .   # after Claude Code has loaded the mod once (it writes .claude-plugin/types/)
```

| File | Role |
| --- | --- |
| `hooks/register.tsx` | Command, player, band and pane drawing |
| `hooks/frames.ts` | Pure helpers: grid fit, frame encoding, MP3 offset |
| `hooks/bad-apple.test.ts` | Tests (`claude plugin test`) |
| `types/index.d.ts` | `$.state` contract (`mode`, `isPaused`) |
| `scripts/download-video.sh` | Downloads the working video file to `work/` |
| `scripts/build-assets.sh` | Builds `assets/` from the working file |

## Credits

Bad Apple!! is a song from Touhou Project by ZUN, arranged by Alstroemeria Records, with the shadow-art PV by Anira.
This repo has no part of the video or the song.

## License

The code is [MIT](LICENSE). The MIT license does not cover the video or the song.
