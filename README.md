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

### 2. Get the database values

The app needs a MongoDB database and a Redis database. If a teammate has already set them up, ask them for the values privately (never in a public chat or in Git). Otherwise create your own free accounts:

**MongoDB Atlas**

1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) and create a free **M0** cluster.
2. Go to **Database Access** and add a database user with a username and password.
3. Go to **Network Access** and add the IP address you will connect from.
4. Go to **Connect → Drivers** and copy the connection string. It looks like:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/`
5. Add the database name `comets-url-shortener` at the end of it.

**Upstash Redis**

1. Sign up at [upstash.com](https://upstash.com) and create a **Redis** database.
2. Open the database and find the **REST API** section.
3. Copy the **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN** values.

### 3. Add the values to `.env.local`

Make your own copy of the example file:

```bash
cp .env.example .env.local
```

Open `.env.local` and replace each placeholder with your real value:

| Variable | Where it comes from |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (step 2) |
| `UPSTASH_REDIS_REST_URL` | Upstash → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → REST API |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` on your laptop |

> **`.env.example` vs `.env.local`:** `.env.example` is committed to Git and only shows *which* variables are needed, with fake values. `.env.local` holds your *real* secrets, is read by Next.js when the app starts, and is ignored by Git so it is never pushed to GitHub.

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

1. Pull the latest `develop` branch.
2. Create your own branch: `git checkout -b <your-name>/<feature>` (e.g. `tripti/day-2-login`).
3. Commit small steps with clear messages and push every day.
4. Open a pull request into `develop`. Another member reviews it.
5. When `develop` works, the Team Lead merges `develop` into `main`. `main` is the live site (Vercel).

## Decisions so far

- Short codes and aliases are **case-insensitive** (`/Geeta-Fest` = `/geeta-fest`).
- Redirects use **302**, so every visit reaches the server and can be counted.
- Analytics days use **IST** (Asia/Kolkata).
- Cache Components is on (Next.js 16 default), so route handlers that must run on every request call `await connection()` instead of using `export const dynamic`.
