# One-sub-tool

English documentation for **One-sub-tool v2.2.0**, a local video subtitle and narration tool for Windows.

Xem hướng dẫn tiếng Việt tại [README.vi.md](README.vi.md).

## Overview

One-sub-tool converts video or audio into timed subtitles, lets you review and translate them, and creates narration without sending local media to a public server. The existing React/Express entry points are kept so the tool can be used locally and extended over time.

## v2.2.0 highlights

- Gemini model discovery and model availability checks.
- Optional Whisper transcription through the local subtitle engine.
- Gemini translation with configurable endpoint, model, and API key from the Settings screen.
- VieNeu-TTS narration with preset voices or reference audio.
- OmniVoice narration with reference, voice-design, and auto voice modes.
- **Preview voice** playback for both VieNeu-TTS and OmniVoice.
- Subtitle editing, translation overrides, grouped subtitles, and selective narration retries.
- Automatic extraction of Douyin URLs from pasted share text.
- Douyin download fallback chain: native resolver, yt-dlp, then ephemeral Chromium.
- Local caching and narration artifacts under the project workspace.
- Model availability checks run only when explicitly requested.
- Centralized cancellation for analysis, model checks, subtitle generation, metadata reads, and analysis dialogs.
- Direct subtitle editing in the timeline: click a subtitle text to edit it and press Enter at the cursor to create a new timed line.
- Deterministic timing split based on the text position, so each split line is sent to TTS as an independent subtitle without random timestamps.
- Edit either the original or translated subtitle track from the same timeline when a translation is available.
- CapCut-style subtitle editing: direct text editing, Enter-to-split, Backspace-at-line-start merge, and manual find/replace.
- The translated preview uses the same editable timeline as the original subtitle track.

## Local architecture

| Component | Default address | Purpose |
| --- | --- | --- |
| React UI | `http://localhost:3030` | Subtitle, translation, narration, and rendering interface |
| Express backend | `http://localhost:3031` | API, downloads, files, and orchestration |
| VieNeu-TTS adapter | `http://localhost:3035` | Local preset/reference narration |
| OmniVoice adapter | `http://localhost:3036` | Local reference/design narration |

The tool is single-user and local-first. It does not require accounts, a cloud database, or a public server.

## Requirements

- Windows 10/11 (the primary supported platform).
- Node.js LTS and npm.
- Python 3.11 managed by [uv](https://github.com/astral-sh/uv).
- FFmpeg and FFprobe available on `PATH`.
- NVIDIA CUDA is optional. `device=auto` falls back to CPU when CUDA is unavailable.
- Gemini API access is optional for local Whisper/subtitle workflows, but required for Gemini translation or analysis.

## Quick start on Windows

```powershell
git clone https://github.com/lythuachau/One-sub-tool.git
cd One-sub-tool
npm install
npm run install:all
npm run dev:cuda
```

Open `http://localhost:3030` after the services start. The first VieNeu-TTS or OmniVoice request may download/load model assets and therefore take longer than later requests.

For subtitle-only work without the local narration services:

```powershell
npm run dev
```

## API and model settings

Open **Settings → API** in the UI to configure the translation provider, base URL, model, and API key. Keys are stored locally and are not included in logs, job snapshots, or this repository. Do not commit `.env.local`, `localStorage.json`, model weights, or generated media.

## Typical workflow

1. Upload a local video/audio file or paste a YouTube/Douyin URL. Pasted Douyin share text is normalized automatically.
2. Choose Gemini or Whisper for subtitle extraction when available.
3. Review and edit subtitle timing and text.
4. Translate through the configured provider and preserve approved subtitle overrides.
5. Open narration settings and choose VieNeu-TTS or OmniVoice.
6. Select the voice source, click **Preview voice**, then generate narration for the subtitle list.
7. Render or download the final video, SRT, JSON, and narration audio.

## Data and troubleshooting

Generated data is kept locally in `videos/`, `subtitles/`, `narration/`, and related cache folders. Restarting the UI does not remove saved results.

- Check `http://localhost:3031/api/health` for backend status.
- Check `http://localhost:3035/api/narration/status` for VieNeu-TTS.
- Check `http://localhost:3036/health` for OmniVoice.
- If narration is unavailable, run `npm run dev:cuda` and wait for the service status to become ready.
- If FFmpeg or FFprobe is missing, install FFmpeg and reopen PowerShell.
- If a GPU model cannot initialize, set the device to `auto` or CPU and retry; CUDA jobs remain single-task to avoid VRAM contention.

## Development commands

```powershell
npm run build              # production frontend build
npm run dev:cuda           # frontend, backend, VieNeu-TTS, and OmniVoice
npm run setup:tts          # install/configure local TTS engines
npm run test:services      # service smoke checks
```

## License

MIT License. See [LICENSE](LICENSE) if present in the distribution.
