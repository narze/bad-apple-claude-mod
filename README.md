# bad-apple-claude-mod

Plays **Bad Apple!!** inside Claude Code, as a mod (a plugin of function hooks).
The video plays in the band above the prompt, or in a side pane, with the song in sync.

- Half-block pixels (`▀`): one terminal row shows two video rows, drawn as one `Raster`
- About 60 repaints a second with `$.ui.blit`, frame picked from the wall clock so video stays in sync with the song
- Pause and resume, also for the song (the mod cuts the constant-bitrate MP3 at the right byte)
- Elapsed time in the status line

## Use

| Command | What it does |
| --- | --- |
| `/bad-apple` | Play in the band above the prompt (default) |
| `/bad-apple pane` | Play in a pane (Esc closes it) |
| `/bad-apple pause` / `resume` | Pause or resume |
| `/bad-apple stop` | Stop |

The band has **Pause/Resume** (`p`) and **Stop** (`s`) buttons.

Sound plays through `afplay`, so only on macOS. Other systems get the video only.

## Install

The video frames and the song are not in this repo. Build them on your machine:

```sh
git clone https://github.com/narze/bad-apple-claude-mod
cd bad-apple-claude-mod
./scripts/build-assets.sh   # needs yt-dlp (or uvx), ffmpeg, python3
claude --plugin-dir "$PWD"
```

The script downloads the PV, makes 96x72 1-bit frames at 30 fps in `assets/frames-*.bin`,
and makes a 96 kbit/s mono MP3 in `assets/bad-apple.mp3`.

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
| `scripts/build-assets.sh` | Builds `assets/` |

## Credits

Bad Apple!! is a song from Touhou Project by ZUN, arranged by Alstroemeria Records, with the shadow-art PV by Anira.
This repo has no part of the video or the song.

## License

The code is [MIT](LICENSE). The MIT license does not cover the video or the song.
