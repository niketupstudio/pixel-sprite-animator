# Pixel Sprite Animator

Browser-local pixel sprite animation editor with built-in Street Fighter II: Champion Edition test sprites.

## What Is Included

- Sprite Sheet selection and automatic frame detection
- Pixel-perfect transparent preview and animation layers
- Frame reordering, multi-select deletion, motion preview and export naming
- Browser-local transparent PNG, PNG Sequence, GIF and ProRes 4444 MOV export
- Bundled GIF and FFmpeg WebAssembly encoders
- A small Node server with optional access-code protection

All image processing and export encoding runs in the user's browser. The server only serves the app and static assets; it does not receive sprite frames or encode video.

## Run Locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev:local
```

Open <http://127.0.0.1:4174/>. The local development entry disables login for convenience. For an authenticated server, set `PIXEL_SPRITE_ACCESS_KEY` and run `npm run dev`.

## Test

```bash
npm test
node --check public/app.js
```

The test suite starts an isolated server, checks authentication, verifies all browser-local export entries, confirms the server-side export endpoints remain disabled, and checks that bundled assets are served.

## Shared Deployment

The optional `share:*` scripts are intended for a private Mac-hosted Cloudflare Tunnel. Read [README_共享部署.md](README_共享部署.md) before enabling them. Never commit `.runtime/`, tunnel tokens, access keys, logs or generated exports.

## Included Assets

The repository includes the current built-in sprite sheets and the browser encoders required for a fresh checkout to run without another asset download.

## Project Notes

The included sprite artwork is retained for local testing and prototype evaluation. Confirm the applicable rights before redistributing the bundled game artwork outside its intended test context.
