# slowmo

Progressive Web App that turns a video into genuinely smooth slow motion —
entirely in the browser, no server, no upload.

Naively slowing a video down just stretches each original frame, so a 30fps
clip slowed 2x plays back at an effective ~15fps and looks jerky. This app
instead runs FFmpeg (compiled to WebAssembly via
[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)) with motion
interpolation (`minterpolate`) to synthesize new in-between frames *before*
slowing down the timeline, so the result stays at a full, constant frame
rate.

## How it works

- Plain HTML/CSS/JS, no build step — deployable as static files (e.g. GitHub
  Pages).
- `@ffmpeg/ffmpeg` + `@ffmpeg/core-mt` (multi-threaded core) are loaded lazily
  from a CDN only when you click "Обработи", so first load stays fast.
- `sw.js` is a single service worker with two jobs:
  1. Add `Cross-Origin-Opener-Policy: same-origin` and
     `Cross-Origin-Embedder-Policy: require-corp` to every same-origin
     response (including the document itself), since GitHub Pages can't set
     custom HTTP headers and the multi-threaded FFmpeg core needs
     `SharedArrayBuffer`, which requires those headers.
  2. Cache the app shell (and the FFmpeg core files fetched at runtime) for
     offline use as an installable PWA.
- If cross-origin isolation isn't available for any reason, processing falls
  back to the single-threaded `@ffmpeg/core` automatically instead of
  breaking.

All paths (asset links, manifest `start_url`/`scope`, service worker
registration) are relative, so the app works when deployed under a subfolder
such as `https://user.github.io/repo-name/`.

## Deploying to GitHub Pages

Push this repo and enable Pages for the branch/folder you deployed to —
no build step is required, the files are served as-is.
