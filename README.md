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
git clone https://github.com/VivekCoderz/Comets-URL-Shortener-with-Analytics-.git
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
AGENTS.md            rules for AI coding tools used on this repo
```

More folders (`components/`, `scripts/`, `tests/`) are added on the day they are first needed.

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
