# Neon River Run

Neon River Run is a modern neon river arcade game built with React, Vite, Canvas and Web Audio.

## What is included

- Responsive canvas gameplay for desktop and mobile.
- Keyboard controls with `WASD`, arrow keys, `Space` and `Esc`.
- Pointer/touch steering for mobile.
- Fuel, hull, score, pickups, obstacles and plasma shots.
- Built-in modern arcade sound effects generated with Web Audio.
- Single-file production build support through `vite-plugin-singlefile`.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

If npm reports a certificate issue on Windows, run the install with system certificates:

```bash
set NODE_OPTIONS=--use-system-ca
npm install
```

## Build

```bash
npm run build
```

The production file is generated at:

```text
dist/index.html
```

Because the build is single-file, `dist/index.html` can be uploaded directly to many static hosts.

## Install On Phone

Neon River Run is configured as a PWA. After publishing it on HTTPS, open the game on the phone and choose the browser option similar to:

- Android/Chrome: `Adicionar a tela inicial` or `Instalar app`.
- iPhone/Safari: share button, then `Adicionar a Tela de Inicio`.

The game includes a web manifest, app icon and service worker cache so it opens like a standalone app after being added to the home screen.

## Publish Options

- GitHub repository with Vercel or Netlify: upload this project, then set build command to `npm run build` and publish directory to `dist`.
- GitHub Pages manual/static option: run `npm run build` and publish the generated `dist/index.html`.
- Local preview after build: run `npm run preview`.

## Sound Notes

The game does not include copied sound files from the original River Raid. The effects are original synthesized sounds created in the browser to keep the project lightweight and safer for public hosting.
