# Deploying Undercover

Undercover is one Node service: it serves the built client, the WebSocket (`/ws`) and `/healthz` on
the same origin, so a single public URL is all players need. Rooms live in memory by default; set
`REDIS_URL` to keep them through restarts and deploys.

Environment variables (see `.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | Defaults to 8080. |
| `REDIS_URL` | recommended | `rediss://...` from Upstash (or any Redis 6+). Without it a deploy wipes live games. |
| `PUBLIC_URL` | recommended | e.g. `https://undercover.fly.dev`. Used for invite links in Open Graph tags. |
| `ALLOWED_ORIGINS` | no | Comma-separated extra origins allowed to open the WebSocket. Same-origin is always allowed. |

## Fly.io (default)

1. Install the CLI and sign in:
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```
2. From the `undercover/` directory, create the app (pick your own name and region; `bom` is Mumbai):
   ```bash
   fly launch --copy-config --no-deploy --name <your-app-name> --region bom
   ```
   This reads `fly.toml` and the `Dockerfile`. Say **no** to Postgres and to Upstash Redis here if it asks; we add Redis next.
3. Create a managed Redis at [Upstash](https://console.upstash.com/redis) (free tier is fine, pick the same region).
   Copy the **TLS** connection string (`rediss://default:...@...upstash.io:6379`).
4. Set secrets:
   ```bash
   fly secrets set REDIS_URL='rediss://default:...@...upstash.io:6379' PUBLIC_URL='https://<your-app-name>.fly.dev'
   ```
5. Deploy:
   ```bash
   fly deploy
   fly status
   curl https://<your-app-name>.fly.dev/healthz
   ```
6. Open `https://<your-app-name>.fly.dev` on your phone. Create a room, share the `/join/CODE` link.

Keep `min_machines_running = 1` (already in `fly.toml`): WebSocket games must not be stopped between requests.
Run exactly one machine unless you move rooms to Redis **and** add sticky routing; the in-process timers assume one process owns a room.

## Railway (alternative)

1. `railway login`, then `railway init` inside `undercover/` and choose **Deploy from Dockerfile**.
2. Add a Redis plugin (or Upstash) and set `REDIS_URL` and `PUBLIC_URL` under Variables.
3. `railway up`. Railway sets `PORT` automatically; the server reads it.

## Render (alternative)

New **Web Service** → connect the repo, root directory `undercover`, runtime **Docker**. Add a Render Key Value (Redis) instance or Upstash, set `REDIS_URL` and `PUBLIC_URL`, deploy. Use a paid instance type: the free tier sleeps and drops WebSockets.

## Docker anywhere

```bash
docker build -t undercover .
docker run -p 8080:8080 -e REDIS_URL=redis://host.docker.internal:6379 -e PUBLIC_URL=http://localhost:8080 undercover
```

## Smoke test against a deployed URL

```bash
cd undercover
npm run smoke -- https://<your-app-name>.fly.dev
```

It creates a room, joins with a second client, starts a game with five headless players and checks they reach the role reveal.

## Operations

- `/healthz` returns `{ ok, rooms, uptime }`.
- Logs never contain roles. Room codes and phases only.
- Idle rooms expire after 3 hours, finished games after 15 minutes.
- Rate limits: 6 room creations and 30 joins per IP per minute.
