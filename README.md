# Camera Dashboard (RTSP -> HLS)

Simple camera dashboard that:

- Stores camera configs in SQLite
- Starts/stops FFmpeg on demand
- Serves HLS playlists/segments and plays them in the browser via `hls.js`

## How It Works

- Camera configs are stored server-side in SQLite (path via `DB_PATH`, default `./data/nahledovka.sqlite`).
- The UI loads cameras from `GET /api/cameras`.
- Each tile starts the camera's sub stream on demand by calling `POST /api/stream` with `{ id, which: "sub" }`.
- Clicking a tile opens a fullscreen view and starts the main stream (`which: "main"`).

## Requirements

- Docker (recommended)
- RTSP camera URLs

## Run With Docker

This repo includes a `docker-compose.yml` that:

- Exposes the app on `http://localhost:3000`
- Persists SQLite data in `./data`

Common commands:

```bash
docker compose up --build
```

## Run On Ubuntu Server (Kiosk)

On a fresh Ubuntu install, run the installer (this is the only command you need):

```bash
curl -fsSL https://nahledovka.cz/install | sudo -E bash
```

Environment variables (optional):

- `KIOSK_USER`: Linux user that runs the kiosk (defaults to the `sudo` user)
- `APP_URL`: URL opened in Chrome app/kiosk mode (default `http://127.0.0.1:3000`)
- `APP_DIR`: install directory (default `/opt/security-cameras-dashboard`)
- `REPO_URL`: git repo URL to clone (default this repo)

To reset the camera database:

```bash
rm -rf data/
```

## Run Without Docker

You need FFmpeg installed on your machine.

```bash
npm install
npm run dev
```

By default the app runs on `http://localhost:3000`.

## Notes

- Streams are written under `public/streams/` inside the app container. FFmpeg is configured to delete old segments as the playlist advances.
- If you deploy this, set `DB_PATH` to a persistent volume.
