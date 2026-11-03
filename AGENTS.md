<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project rules for AI coding agents (Team Comets)

These rules apply to any AI tool a team member uses on this repo (Claude Code, Copilot, Cursor, ChatGPT…).

## What this project is
- URL shortener with analytics, guest links, custom QR codes and one-click sharing.
- The source of truth for features is the team's PRD v1.5 (kept outside this repo). If a request conflicts with the PRD, or the PRD marks something as TBD, **ask the team member, do not guess**.

## Stack (do not change without the team agreeing)
- Next.js 16 App Router, JavaScript (no TypeScript), Tailwind CSS 4.
- MongoDB with Mongoose (`lib/db.js`), Upstash Redis (`lib/redis.js`), Zod for validation.
- Backend = Route Handlers in `app/api/**/route.js`. No separate Express server.
- Cache Components is ON. Do not use `export const dynamic = ...`. In route handlers that must run per request and don't read the request, call `await connection()` from `next/server`.
- In Next.js 16, `middleware.js` is called `proxy.js`. Check the docs in `node_modules/next/dist/docs/` first.

## Code rules
- Read environment variables only through `getEnv()` in `lib/env.js`. Add new ones to the schema there and to `.env.example`.
- Call `await connectDB()` before using any Mongoose model.
- Validate every input with Zod on the server, even if the form also validates it.
- Error responses use `{ "error": { "code": "SOME_CODE", "message": "..." } }`.
- Keep code simple and commented where the reason is not obvious. Team members must explain this code in their viva.
- Never commit secrets, `.env.local` or API keys.

## Git rules
- One branch per member and feature (e.g. `vivek/day-3-shorten`). Open a pull request into `dev`.
- Clear commit messages.
