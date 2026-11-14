# Railway website deployment

The cloud website runs `cloud-server.mjs`; the existing LAN gateway continues to use `server.mjs`. The Dockerfile starts only the cloud server and copies only public assets and its server source. It does not include the local configuration, ESP32 secrets, or node_modules.

## Cloud environment

- `SITE_USERNAME`: website sign-in username.
- `SITE_PASSWORD`: a unique random password of at least 24 characters, stored in Railway Variables, never in source control or browser code.
- `PORT`: supplied by Railway. The server listens on `0.0.0.0` by default.
- Healthcheck path: `/healthz`.
- One replica. Login sessions are in memory and expire after 12 hours or a service restart; sign in again after a deploy. Saved calibration stays in this browser, separately from the login session.
- Disable Serverless sleeping and use an appropriate funded plan to keep the service running. Configure automatic restarts in Railway service settings.

The initial cloud release has one shared website login, not separate registered user accounts. Login uses an HttpOnly, Secure, SameSite cookie. Sign-in attempts are rate limited. The app and MediaPipe files require a session. Login styling/fonts and a minimal health endpoint are public.

## Initial release scope

Camera preview, local MediaPipe processing, and local calibration profiles are available after sign-in. All appliance commands are rejected with HTTP 503, and the website explains that the controller connection is not set up. There is no simulated success, remote ESP32 connection, video upload, or video storage. Firmware changes will be a separate step.

Configure `control.carla.codes` in Railway and add exactly its supplied DNS records in Cloudflare after checking for existing records. Use DNS-only CNAME routing for initial certificate verification. Do not replace the root domain or another service's records.

Use the Railway hostname to verify HTTPS, sign-in, authenticated assets, health, and disabled command behavior before calling the deployment live. A Railway resource limit or trial expiry can prevent continuous operation even when the source is ready.

## Local verification

`node --test test/*.test.mjs` passes 26 tests, including cloud authentication, model protection, cross-origin form rejection, session cookie attributes, logout, command rejection, and login rate limiting. The existing gesture/profile tests also pass.
