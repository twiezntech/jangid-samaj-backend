# Jangid Samaj Digital Platform — Backend API

Node.js + Express + TypeScript + Prisma + PostgreSQL. One versioned API (`/api/v1`) for the Website, the Admin Panel and the future Mobile App.

## Modules

| Module | Public reads | Editorial / admin writes |
|---|---|---|
| Locations (State → District → City → Tehsil → Village) | `GET /locations`, `/locations/detail/*` | `location.manage` |
| **News** (hi/en, categories, tags, scheduling) | `GET /news`, `/news/:slug` | draft → review → publish workflow |
| **Directory** (organisations, committees, samaj bhawans, contacts) | `GET /directory`, `/directory/:slug` | submit → approve → verify |
| **Leaders** (sarpanch, representatives, presidents…) | `GET /leaders`, `/leaders/:slug` | submit → approve → verify |
| Auth | register / verify-email / login / refresh / logout / me / google | email verification, Turnstile, lockout, token rotation |
| Admin | — | users & roles, audit log |

Security model in one paragraph: HttpOnly cookie sessions with rotating refresh tokens (reuse revokes the family), CSRF origin check, Turnstile + honeypot on public auth, bcrypt(12), rate limits, zod validation with `.strict()` bodies, HTML sanitised on write, image-host allow-list, RBAC by permission (+ location scope for district admins / city reporters), append-only audit log written in the same transaction as the change, pino logs with secrets redacted.

## Local setup

```bash
cp .env.example .env         # fill secrets; generate JWT secrets with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npx prisma migrate deploy    # apply migrations
npm run db:seed              # roles, permissions, locations, demo content + dev accounts (prints the password)
npm run dev                  # http://localhost:4100
```

`GET /health` (liveness) and `GET /ready` (checks the database).

## Tests

```bash
npm test                     # vitest + supertest against a throw-away database (jangid_samaj_test)
npm run typecheck
```

The test run drops/recreates `jangid_samaj_test`, migrates and seeds it — it never touches the development database.

## Production notes

- `NODE_ENV=production` requires `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, JWT secrets ≥ 32 chars; the seed only creates a super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (≥ 12 chars).
- Set `COOKIE_DOMAIN`, `CORS_ORIGINS`, `APP_URL` and run behind a reverse proxy (`trust proxy` is enabled in production).
- Scheduled stories are promoted by an atomic SQL sweep every minute; safe to run on several instances.
- Ports used in this workspace: API `4100`, website `3010`, local Postgres `5433`.
