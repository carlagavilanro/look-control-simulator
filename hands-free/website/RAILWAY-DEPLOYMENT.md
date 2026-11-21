# Railway website deployment

The cloud website runs `cloud-server.mjs`; the existing LAN gateway continues to use `server.mjs`. The Dockerfile starts only the cloud server and copies only public assets and its server source. It does not include the local configuration, ESP32 secrets, or node_modules.

## Devices, boards and storage (November)

The cloud server now includes the device hub (`hub.mjs`): devices and their buttons, the recordings sent by the receiver board, and the commands the transmitter board collects. Boards and the Windows app connect out to the site; the site never connects to them.

- The service builds from GitHub: repository `carlagavilanro/look-control-simulator`, branch `main`, root directory `/hands-free/website`. A push to `main` deploys.
- **Storage:** attach a Railway volume to the service (for example at `/data`). The server keeps `hub.json` in `RAILWAY_VOLUME_MOUNT_PATH`. Because the image runs as a non-root user and a volume belongs to root, also set the variable `RAILWAY_RUN_UID=0`. Without a volume the setup lasts only until the next restart, and the Setup page says so.
- Keep **one replica**: links being typed and commands in flight are held in memory.
- New routes: `/setup` (signed in), `/api/hub`, `/api/send` and the setup routes (signed in, or a linked app for looking, sending and setting up a device), `/api/pair/start` and `/api/pair/claim` (public, rate limited: a board or app asks for a link code), `/api/device/*` (a linked board, with its own key).
- Only a hash of each board or app key is stored. Requests that change something with the sign-in cookie must come from the site's own pages.
- The site's pages may be framed by the site itself (`X-Frame-Options: SAMEORIGIN`): in a browser, Screen control shows the Devices and Setup pages in a frame so they can be used with the eye pointer.
- The Windows download is no longer in the image: `/downloads/Hands-Free-Screen-Control-Windows.zip` redirects to the newest GitHub release, which the build publishes.

## Cloud environment

- `SITE_USERNAME`: website sign-in username.
- `SITE_PASSWORD`: a unique random password of at least 24 characters, stored in Railway Variables, never in source control or browser code.
- `PORT`: supplied by Railway. The server listens on `0.0.0.0` by default.
- Healthcheck path: `/healthz`.
- One replica. Login sessions are in memory and expire after 12 hours or a service restart; sign in again after a deploy. Saved calibration stays in this browser, separately from the login session.
- Disable Serverless sleeping and use an appropriate funded plan to keep the service running. Configure automatic restarts in Railway service settings.

The initial cloud release has one shared website login, not separate registered user accounts. Login uses an HttpOnly, Secure, SameSite cookie. Sign-in attempts are rate limited. The app and MediaPipe files require a session. Login styling/fonts and a minimal health endpoint are public.

## Scope

Camera preview, local MediaPipe processing, and local calibration profiles are available after sign-in. Device commands go to a linked transmitter board; with none linked or online they are rejected and the page says that nothing was sent. There is no simulated success, video upload, or video storage.

Configure `control.carla.codes` in Railway and add exactly its supplied DNS records in Cloudflare after checking for existing records. Use DNS-only CNAME routing for initial certificate verification. Do not replace the root domain or another service's records.

Use the Railway hostname to verify HTTPS, sign-in, authenticated assets, health, and disabled command behavior before calling the deployment live. A Railway resource limit or trial expiry can prevent continuous operation even when the source is ready.

## Local verification

`node --test test/*.test.mjs` passes 26 tests, including cloud authentication, model protection, cross-origin form rejection, session cookie attributes, logout, command rejection, and login rate limiting. The existing gesture/profile tests also pass.
