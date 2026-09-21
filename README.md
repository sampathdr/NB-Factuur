# NB-Factuur

A Dutch invoice generator built for Cloudflare Workers' free tier, following
Belastingdienst/KvK mandatory-invoice-field requirements.

## Stack

- **Cloudflare Workers** (Hono) — API + static asset hosting, one deployment
- **D1** — companies, clients, invoices (SQLite, free tier)
- **R2** — company logo storage (free tier)
- **Arctic** — Google OAuth (PKCE), session cookie backed by a `sessions` table in D1
- **pdf-lib** — server-side PDF generation (no headless browser needed, so it
  stays on the free Workers tier)

## What v1 supports

- Google sign-in; multi-tenant — one Google account can own several companies
- Company profile: legal/trade name, KvK number, VAT number, IBAN, logo upload
- Saved client list per company
- Invoices with line items, VAT calculated server-side (client input is never trusted)
- VAT schemes: standard (21/9/0%), KOR (VAT-exempt small business), EU reverse-charge (BTW verlegd)
- Invoice numbering: auto-increment (`PREFIX-YYYY-0001`, sequential per company) or manual entry
- Multi-currency (EUR, USD, GBP, CHF, SEK, NOK, DKK) — amounts stored as integer cents
- PDF export with all Belastingdienst-mandatory fields

**Not in v1** (by design, can be added later): payment status tracking, quotes/recurring invoices, emailing invoices.

## One-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler login
npx wrangler d1 create nb-factuur-db
```

Copy the `database_id` from the output into `wrangler.toml` under `[[d1_databases]]`.

Then apply the schema:

```bash
npm run db:migrate:local    # for local `wrangler dev`
npm run db:migrate:remote   # for production
```

### 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create nb-factuur-logos
```

### 4. Create a Google OAuth client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth client ID** of type "Web application".
3. Add authorized redirect URIs:
   - `http://localhost:8787/auth/google/callback` (local dev)
   - `https://<your-worker-subdomain>.workers.dev/auth/google/callback` (production — or your custom domain)
4. Copy the Client ID and Client Secret.

### 5. Configure secrets

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in the values
(never commit this file — it's already gitignored).

For production:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET   # any long random string
```

Also update `APP_URL` in `wrangler.toml` under `[vars]` to your production URL
once you know your `*.workers.dev` subdomain (or custom domain), then redeploy.

### 6. Run locally

```bash
npm run dev
```

Visit `http://localhost:8787`.

### 7. Deploy

```bash
npm run deploy
```

## Continuous deployment (optional)

The repo includes two GitHub Actions workflows:

- **`.github/workflows/ci.yml`** — runs on every push/PR: typechecks and does
  a `wrangler deploy --dry-run` to catch config/bundling errors before merge.
  Works out of the box, no setup needed.
- **`.github/workflows/deploy.yml`** — deploys to Cloudflare on every push to
  `main`. It's off by default so CI doesn't fail on forks/before setup. To
  turn it on:
  1. Create a Cloudflare API token with the "Edit Cloudflare Workers" template
     at https://dash.cloudflare.com/profile/api-tokens
  2. In the repo: **Settings → Secrets and variables → Actions**, add secrets
     `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (find the account ID
     on the right sidebar of any page in the Cloudflare dashboard)
  3. In the same **Variables** tab, add a repo variable `DEPLOY_ENABLED` set
     to `true`

## Project layout

```
src/
  index.ts            Worker entry point, route wiring
  routes/
    auth.ts            Google OAuth login/callback/logout
    companies.ts        Company CRUD + logo upload/serve
    clients.ts           Client (customer) CRUD
    invoices.ts          Invoice creation, VAT calc, PDF export
  lib/
    auth.ts              Session + OAuth helpers
    middleware.ts         requireAuth / company-ownership checks
    pdf.ts                 pdf-lib invoice layout
    util.ts                 IDs, money formatting
  types.ts              Shared types + Env bindings
public/                 Static frontend (served directly by Workers assets)
schema.sql              D1 schema
```

## Compliance notes

This app enforces the Belastingdienst's mandatory invoice fields (company
name/address, KvK number, VAT number, invoice date, sequential invoice
number, delivery date, client details, line-item descriptions, VAT
breakdown) and applies the correct wording for KOR and EU reverse-charge
invoices. It does not constitute tax or legal advice — for anything
scheme-specific to your situation (e.g. intra-EU thresholds, OSS
registration), check with the Belastingdienst or your accountant.

If you use **manual** invoice numbering, Dutch law still requires numbers to
be gapless and sequential — the app only guarantees uniqueness for manual
numbers, so stick to auto-generated numbering unless you have a specific
reason not to.
