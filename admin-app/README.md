# Anonymous Whistleblowing & Complaint System — admin-app

This is the **admin half** of a two-app system — see `../ARCHITECTURE.md`
for the full picture. This app is where complaints actually get decrypted
and managed. It runs on its own Vercel project, its own domain, its own
Supabase database, and sits behind an IP allowlist enforced in
`middleware.ts` — the actual access-control boundary this split exists
for. `../public-app` is the one strangers reach; this one shouldn't be
reachable by anyone but you.

## Folder structure

```
admin-app/
├── README.md
├── package.json
├── .env.local.example
├── middleware.ts              IP allowlist — runs before every request
├── app/
│   ├── layout.tsx
│   ├── globals.css            same design tokens as public-app
│   ├── page.tsx                the dashboard (only route besides API)
│   └── api/
│       ├── complaints/route.ts            GET list (from local cache)
│       ├── complaints/[id]/route.ts       PATCH update (local write + push to intake)
│       └── sync/route.ts                  GET — pulls intake changes into local cache
├── components/
│   └── AdminDashboard.tsx     setup/unlock, list, decrypt, manage, manual entry
├── lib/
│   ├── crypto/hybrid.ts       identical copy of public-app's — verified byte-for-byte
│   ├── supabaseAdmin.ts       THIS app's own database client (not intake)
│   └── sync/
│       ├── intakeAuth.ts      mints short-lived sync_reader/sync_writer JWTs
│       ├── intakeClient.ts    raw PostgREST calls to intake, using those JWTs
│       └── orchestrate.ts     pull/push logic, dirty-row conflict handling
└── supabase/schema.sql        local cache schema — a synced copy, not a second source of truth
```

## How this reaches the other app's data

**It doesn't, directly — there's no direct database connection anywhere
in this bridge.** Everything goes through intake's PostgREST HTTPS API,
authenticated as one of two narrowly-scoped Postgres roles
(`sync_reader`, `sync_writer`) that public-app's `schema.sql` creates.
This app never holds intake's service-role key. See that file's comments
for exactly what those two roles can and can't touch — the short version:
`sync_reader` can only `SELECT` two tables and never sees the abuse log;
`sync_writer` can only `UPDATE` a handful of named columns, and can never
touch a complaint's actual encrypted content or its tracking code.

A scheduled job (`/api/sync`, Vercel Cron) pulls changed complaints into
this app's own database on an interval. The dashboard reads from that
local copy — not live from intake — so it stays fast and works even
mid-sync. Edits push back to intake immediately (not batched), and a row
stays flagged "not yet synced" (⚠ in the sidebar) if that push hasn't
been confirmed, so nothing silently vanishes on a bad connection.

## Setup

1. **Scaffold**: `npx create-next-app@latest admin-app --typescript --tailwind --app`,
   then copy every file above in, overwriting the generated defaults.
2. `npm install`
3. **A second, separate Supabase project** (do not reuse intake's):
   run `supabase/schema.sql` here, copy its URL and service-role key into
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
4. **Point at intake**: from public-app's Supabase project, copy its URL,
   anon/publishable key, and JWT secret into `INTAKE_URL` /
   `INTAKE_ANON_KEY` / `INTAKE_JWT_SECRET`. Confirm public-app's
   `schema.sql` has actually been run there first — this app has nothing
   to sync until `sync_reader`/`sync_writer` exist on that side.
5. **Find your IP** and set `ADMIN_ALLOWED_IPS`. If you're testing
   locally before deploying, note that `middleware.ts` fails CLOSED —
   an empty/missing allowlist blocks everyone, including you, on purpose.
6. Set `ADMIN_API_TOKEN`, `CRON_SECRET`, `NEXT_PUBLIC_PUBLIC_APP_URL`, and
   `NEXT_PUBLIC_PUBLIC_APP_MANUAL_ENTRY_TOKEN` (matching public-app's
   `MANUAL_ENTRY_TOKEN`).
7. **Deploy to Vercel** on its own project (a different one from
   public-app — that's the whole point). Add
   `{ "crons": [{ "path": "/api/sync", "schedule": "*/2 * * * *" }] }`
   to `vercel.json`.
8. Open the deployed URL from your allowlisted IP, complete first-time
   key setup, and paste the printed public key into **both** apps'
   `NEXT_PUBLIC_ADMIN_PUBLIC_KEY_JWK` — redeploy both.

## Before this handles real reports

- **IP allowlisting is real access control on Vercel specifically** —
  its docs confirm `x-forwarded-for` is edge-controlled there and not
  spoofable by a client the way it could be on an arbitrary self-hosted
  reverse proxy. If you ever move this off Vercel, re-verify that
  property holds wherever it lands, or `middleware.ts` becomes
  decorative.
- **One admin, one token, one passphrase** is what this is built for, per
  the brief. Multiple admins would need real per-person accounts (and a
  reason to reconsider whether a single shared RSA keypair is still the
  right model, versus each admin having their own).
- **The sync interval is a real gap window.** Between an intake write and
  the next `/api/sync` pull, a new complaint or a complainant's review
  request won't show here yet. Shorten the cron schedule if that matters
  more than the extra Supabase/Vercel usage it costs.
- **Losing this app's database is recoverable** (re-sync from intake
  rebuilds it) **except** for any `locally_dirty` edit that hadn't
  confirmed pushing to intake yet at the moment it was lost.
- Before this handles real, high-stakes reports: a proper security
  review, not just this build pass — same as public-app.
