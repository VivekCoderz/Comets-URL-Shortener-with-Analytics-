# Comets URL Shortener

Short, readable links with custom QR codes, one-click sharing and click analytics.
Built by **Team Comets** (Elite Batch, Project 1): Vivek, Imran Nazir, Aayush Jha, Tripti Mittal.

## Tech stack

| Part | Tool |
|---|---|
| Frontend + backend | Next.js 16 (App Router), JavaScript |
| Styling | Tailwind CSS 4 |
| Database | MongoDB Atlas (free tier) with Mongoose |
| Cache, queues, rate limits | Upstash Redis (free tier) |
| Validation | Zod |
| Hosting | Vercel |

## Run it on your laptop

You need **Node.js 20.9 or newer** (check with `node -v`) and Git.

### 1. Clone and install

```bash
git clone <repo-url>
cd Comets-URL-Shortener-with-Analytics-
npm install
```

### 2. Create free accounts (one per team is enough; share the values privately)

- **MongoDB Atlas** – https://www.mongodb.com/cloud/atlas → create a free M0 cluster → *Database Access*: add a user → *Network Access*: allow your IP (or `0.0.0.0/0` for now) → *Connect → Drivers*: copy the connection string.
- **Upstash Redis** – https://upstash.com → create a Redis database → copy the **REST URL** and **REST token**.

### 3. Add your secrets

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the values. This file is ignored by Git, so it never gets committed.

### 4. Start the app

```bash
npm run dev
```

Open http://localhost:3000, then http://localhost:3000/api/health. You should see:

```json
{ "status": "ok", "mongodb": { "ok": true, ... }, "redis": { "ok": true, ... } }
```

If a part says `"ok": false`, its `error` field tells you what is wrong (usually a wrong value in `.env.local` or your IP not allowed in Atlas).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build (also checks the code compiles) |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm test` | Run the Vitest tests in `tests/` (uses the database in `.env.local`) |

## Folder structure

```
app/                 pages and route handlers (backend)
  api/health/        GET /api/health – checks MongoDB and Redis
  page.jsx           home page
lib/
  env.js             reads and checks environment variables (Zod)
  db.js              cached MongoDB connection – call connectDB()
  redis.js           Upstash Redis client – call getRedis()
models/              Mongoose models (see models/README.md)
  Click.js           one document per click (TTL 180 days)
  ApiKey.js          API keys, stored only as a SHA-256 hash
  DailyStat.js       daily totals per link, read by the dashboards
AGENTS.md            rules for AI coding tools used on this repo
```

More folders (`components/`, `scripts/`, `tests/`) are added on the day they are first needed.

## API

This is the contract every member builds against (PRD v1.6, section 9). Change it only after the team agrees.

- All endpoints are Route Handlers under `app/api`, except the redirect (`app/[code]/route.js`).
- **JWT** = the login cookie. **API key** = `Authorization: Bearer sk_…`. **—** = no login needed.
- Every error looks like `{ "error": { "code": "ALIAS_TAKEN", "message": "…" } }`.

| Method | Path | Auth | What it does | Day |
|---|---|---|---|---|
| GET | `/api/health` | — | MongoDB and Redis status | 1 |
| POST | `/api/auth/signup` | — | `{ email, password, name }` → `{ user }` (JWT set in cookie) | 2 |
| POST | `/api/auth/login` | — | `{ email, password }` → `{ user }` (JWT set in cookie) | 2 |
| POST | `/api/auth/logout` | JWT | Clears the cookie | 2 |
| GET | `/api/auth/me` | JWT | Current user, plan, today's remaining link quota | 2 |
| POST | `/api/links` | JWT or guest | `{ longUrl, alias?, title?, expiresAt?, maxClicks?, password?, qrStyle?, forceNew? }` → link + `shortUrl`, or `{ duplicate: true, existing }` | 3–4, 8–10 |
| GET | `/api/links` | JWT | List own links; `?page`, `?limit`, `?search`, `?status` | 3 |
| GET | `/api/links/:id` | JWT | One link with settings | 3 |
| PATCH | `/api/links/:id` | JWT | Edit destination, title, expiry, password, QR style, isActive; clears cache | 8–10 |
| DELETE | `/api/links/:id` | JWT | Soft delete; clears cache | 4 |
| GET | `/[code]` | — | Redirect (302), or send to `/p/[code]`, `/expired` or 404 | 5 |
| POST | `/api/r/[code]/unlock` | — | Check link password, then 302 to destination | 9 |
| POST | `/api/cron/flush-clicks` | `CRON_SECRET` | Process queued click events (every minute) | 6 |
| GET | `/api/links/:id/analytics` | JWT | `?range=7d\|30d\|90d` → totals (clicks, unique, refreshes), daily series, breakdowns | 7 |
| GET | `/api/analytics/overview` | JWT | Totals across all links, top links | 14 |
| GET | `/api/links/:id/qr` | JWT | `?size=128–1024` → PNG with the saved QR style. TBD: how guests get their QR | 10 |
| POST | `/api/keys` | JWT | `{ name, scopes }` → full key (shown once) | 12 |
| GET | `/api/keys` | JWT | List keys (prefix, scopes, lastUsedAt) | 12 |
| DELETE | `/api/keys/:id` | JWT | Revoke key | 12 |
| POST | `/api/v1/links` | API key | Create link (scope `links:write`); same daily limit | 12 |
| GET | `/api/v1/links` | API key | List links (scope `links:read`) | 12 |
| GET | `/api/v1/links/:code/analytics` | API key | Analytics (scope `analytics:read`) | 12 |

Pro plan and payment endpoints will be added once FR-15 is decided.

### Status codes

| Code | When |
|---|---|
| 200 / 201 | Success / created (200 with `duplicate: true` when the same URL already exists) |
| 302 | Redirect to the long URL |
| 400 | Validation error (`INVALID_URL`, `INVALID_ALIAS`, `RESERVED_ALIAS`, `INVALID_QR_IMAGE`) |
| 401 | Missing or invalid JWT or API key |
| 403 | Not the owner, or API key missing a scope |
| 404 | Link or code not found (also deleted links) |
| 409 | Email or alias already taken |
| 410 | Link expired (date or clicks), for API clients |
| 422 | URL flagged as unsafe |
| 429 | Rate limit or daily link limit reached |

## How we work

1. Pull the latest `dev` branch.
2. Create your own branch: `git checkout -b <your-name>/<feature>` (e.g. `tripti/day-2-login`).
3. Commit small steps with clear messages and push every day.
4. Open a pull request into `dev`. Another member reviews it.
5. `dev` is merged into `main` when a feature set is stable.

## Decisions so far

- Short codes and aliases are **case-insensitive** (`/Geeta-Fest` = `/geeta-fest`).
- Redirects use **302**, so every visit reaches the server and can be counted.
- Analytics days use **IST** (Asia/Kolkata).
- Cache Components is on (Next.js 16 default), so route handlers that must run on every request call `await connection()` instead of using `export const dynamic`.
