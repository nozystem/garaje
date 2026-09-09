# Deploying to Vercel

Three steps. The first two are free accounts.

## 1. Database (Neon)

1. Sign up at [neon.tech](https://neon.tech).
2. Create a project. Region: **Frankfurt** or **Paris** if you are in Europe.
3. Copy the connection string. It looks like this:

```
postgresql://user:password@ep-something-123.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

You do not need to create any tables: the API creates the schema on startup.

> Supabase works the same. What matters is that it is PostgreSQL and that its
> free tier does not put the database to sleep.

## 2. Session secret

Generate one and keep it:

```bash
openssl rand -base64 48
```

It signs session tokens. Changing it signs everyone out.

## 3. Vercel

1. Push the repository to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new). Leave the settings
   screen untouched: `vercel.json` already defines them.
3. Before deploying, open **Environment Variables** and add both:

   | Name | Value |
   | ---- | ----- |
   | `POSTGRES_URL` | the Neon connection string from step 1 |
   | `AUTH_SECRET` | the output of step 2 |

   Tick *Production*, *Preview* and *Development*.

4. **Deploy**.

## Checking it worked

```bash
curl https://YOUR-PROJECT.vercel.app/api/health
```

Should return:

```json
{ "status": "ok", "database": true, "time": "..." }
```

If `database` is `false`, `POSTGRES_URL` did not reach the function: check that
it is enabled for *Production* and redeploy — environment variables do not
apply to existing deployments.

## What gets deployed

- `www/` — the Angular app, served as static files.
- `api/index.ts` — the API. Vercel routes everything under `/api/*` there by
  folder convention. It reuses the same handler `server.ts` uses locally, so
  there are no two code paths that can drift apart.
