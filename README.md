# Garage

Vehicle maintenance tracker. Register your cars and motorbikes, log what you
have done to them, and the app works out what is due and when — by mileage, by
time, or by whichever comes first.

**Ionic 9 · Angular 22 · TypeScript · Node API · PostgreSQL**

Every person gets an account: data lives on the server and is available from
any device.

## What it does

- **Accounts** with email and password. The same garage from your phone,
  tablet or laptop.
- **Vehicles** with photo, plate, mileage and estimated monthly usage.
- **Maintenance plans** with intervals in kilometres and/or months, seeded from
  a list of common tasks (oil, brakes, inspection, timing belt…).
- **Alerts** sorted by urgency, with an estimated due date projected from the
  vehicle's real usage.
- **History** of services with cost and workshop.
- **Catalog** of 89 makes and 1,848 models served by the API.

## What makes it interesting

The **due-date calculation**
([`maintenance-calculator.ts`](src/app/core/services/maintenance-calculator.ts))
is the core of the project. A plan can fall due by mileage, by time, or by
both; when there are two criteria the one that runs out first wins, which is
how service books are written ("every 15,000 km or 12 months, whichever comes
first"). It is framework-agnostic and covered by tests.

Three **business rules live on the server**, not in the client:

- Logging a service with more mileage than known updates the vehicle's
  odometer; an older one never rolls it back.
- Completing a scheduled task reschedules it automatically.
- Deleting a vehicle takes its history and plans with it.

The **vehicle catalog** merges the open
[open-vehicle-db](https://github.com/plowman/open-vehicle-db) dataset with a
local catalog for the Spanish market: the original does not include SEAT,
Cupra, Dacia, Škoda, Citroën, Opel or Volkswagen, and only lists the Renault
models sold in the US during the eighties. NHTSA vPIC (no European makes),
CarQueryAPI (offline) and auto-data.net (commercial) were also evaluated. See
[`server/lib/catalog.ts`](server/lib/catalog.ts).

## Authentication

Implemented in the API itself, without third-party services:

- **Passwords** hashed with `scrypt` (N=16384, the minimum OWASP recommends for
  interactive use) and a per-password salt. Node's own `crypto` is used instead
  of bcrypt to avoid a native dependency, which complicates serverless
  deployments.
- **Sessions** as a JWT signed with HMAC-SHA256, in an `httpOnly`,
  `SameSite=Lax` cookie: not reachable from JavaScript, so an XSS cannot steal
  it. Marked `Secure` in production.
- **Constant-time comparisons** for both the password and the token signature,
  and the same error whether the email does not exist or the password is wrong,
  so registered addresses cannot be probed.
- **Isolation** enforced in the query, not just the UI: every `SELECT` filters
  by `user_id`.

Requires `AUTH_SECRET` (32 characters minimum). Without it the API refuses to
start, because anyone could forge valid tokens:

```bash
openssl rand -base64 48
```

## Requirements

Node 22.

```bash
nvm use 22
npm install --legacy-peer-deps
```

> The flag works around a peer-resolution bug in npm 10.9 with vitest. It does
> not change the installed versions.

## Development

Two processes: the API and the app. PostgreSQL is required — accounts have to
survive restarts.

```bash
npm run api:env    # API on :3210, reading .env.local
npm start          # app on :4200, proxying /api
```

`.env.local` (already gitignored):

```
POSTGRES_URL=postgres://user@127.0.0.1:5432/garage
AUTH_SECRET=anything-longer-than-32-characters-for-local
```

The schema is created on startup. Tables use foreign keys with
`ON DELETE CASCADE`, so deleting an account or a vehicle removes what hangs off
it without the application having to remember.

## Commands

| Command | What it does |
| ------- | ------------ |
| `npm start` | Dev server |
| `npm run api:env` | API with `.env.local`, watching for changes |
| `npm run build` | Production build into `www/` |
| `npm test` | Tests (vitest, against an ephemeral PostgreSQL) |
| `npm run lint` | ESLint |
| `node scripts/fetch-vehicle-db.mjs` | Refresh the external catalog |

## Deployment

See [DEPLOY.md](DEPLOY.md).

## Mobile app

The web build works as a PWA. To produce a native binary:

```bash
npm install @capacitor/core @capacitor/cli --legacy-peer-deps
npx cap init garage com.sergiorubio.garage --web-dir=www

npm install @capacitor/android --legacy-peer-deps
npx cap add android
npm run build && npx cap sync
npx cap open android
```

Run `npx cap sync` after every `npm run build`.

## Layout

```
server.ts                 API entry point for local development
api/index.ts              API entry point on Vercel
server/lib/               Routing, validation, storage, auth and catalog
server/data/              Downloaded external catalog
src/app/core/             Models, due-date calculation and state
src/app/pages/            Screens
src/app/shared/           Reusable components and pipes
scripts/                  Project maintenance utilities
```
