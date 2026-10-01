# DropZone
Self-hosted file hosting website with Google login.

```
## Installation

```bash
git clone https://github.com/UnsoberDriver/DropZone
cd DropZone
cp .env.example .env      # Windows: copy .env.example .env
cd DropZone
npm install
```

Fill in `.env` (see below), then start the server:

```bash
node server.js
```

The site is available at `http://localhost:3000` (or your `BASE_URL`).

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (`node -v` to check)
- A Google account to create OAuth credentials

## Features

- Google OAuth sign-in, restricted to a whitelist of emails
- File manager: browse, create folders, rename, copy, move, delete
- Chunked uploads (large files supported)
- Downloads with resume support (HTTP range requests)
- Files stored on your own machine, in a folder you choose

## Configuration

The `.env` file is read from the repository root, one level above `server.js`.

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | OAuth client ID from Google |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret from Google |
| `SESSION_SECRET` | Yes | Random string used to sign cookies |
| `BASE_URL` | Yes | Public URL of the site, e.g. `http://localhost:3000` |
| `ALLOWED_EMAILS` | Yes | Comma-separated list of authorized Google emails |
| `STORAGE_DIR` | No | Folder where files are stored (default: `./files`) |
| `PORT` | No | Server port (default: `3000`) |

The server refuses to start if a required variable is missing.

Generate a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Google OAuth setup

1. Open the [Google Cloud Console](https://console.cloud.google.com) and create a project.
2. Configure the **OAuth consent screen** (External, add yourself as a test user).
3. Go to **Credentials** > **Create credentials** > **OAuth client ID** > **Web application**.
4. Add this **Authorized redirect URI**: `<BASE_URL>/auth/callback`
   (e.g. `http://localhost:3000/auth/callback`).
5. Copy the client ID and secret into `.env`.

Each person who installs DropZone uses their own credentials and their own storage.

## Project structure

```
DropZone/            <- repository root
├── .env.example     <- configuration template
└── DropZone/
    ├── server.js
    ├── package.json
    └── public/      <- web interface
```

## Usage

1. Open the site and sign in with an authorized Google account.
2. Upload, organize and download your files from the interface.
3. Sign out with `/auth/logout`.

## Deployment notes

- Session cookies are marked `Secure`: use HTTPS (e.g. behind a reverse proxy or tunnel) when exposing the site beyond `localhost`.
- The server trusts the first proxy (`trust proxy`), so it works behind Nginx, Caddy or Cloudflare Tunnel.
- Keep `.env` private. If it is ever published, regenerate the Google client secret and `SESSION_SECRET`.

## Troubleshooting

- **`Config auth manquante (.env)`**: a required variable is missing, or `.env` is not in the repository root.
- **`Accès refusé`**: the Google account is not listed in `ALLOWED_EMAILS`.
- **`redirect_uri_mismatch`**: the redirect URI in Google Cloud does not exactly match `<BASE_URL>/auth/callback`.
