# Security plan

## Model
Two roles: **admin** (owner/admin) and **user** (staff, view-only). Every protected table has RLS enabled; `anon` has no table or function privileges.

| Table | Staff (`user`) | Admin |
| --- | --- | --- |
| profiles | read own; update own `full_name` | read all; update any (role change) |
| products | read | read; update editable columns |
| product_stock_history | read | read |
| sales | read | read (writes only via `import_sales`) |
| tax_invoices | read | read (writes only via `save_invoice`, `mark_invoice_exported`, `import_invoices`) |
| company_profile | read | read; insert/update (`id = 1`) |
| monthly_targets | read | read; delete; upsert via `set_monthly_target` |
| sync_logs | read | read (writes via `record_import`) |
| audit_logs | none | read |

Other controls: `guard_profile_update` blocks non-admins changing `role`/`email`/`id` and blocks demoting the last admin; `guard_profile_delete` blocks deleting the last admin; all functions have `search_path = ''`; `EXECUTE` revoked from `PUBLIC`/`anon` and granted explicitly; column-level `UPDATE` grants exclude generated columns; list RPCs escape `%`, `_`, `\` so search input cannot become a wildcard.

## Secrets
- Browser: only `VITE_SUPABASE_URL` and the publishable/anon key.
- Server only (Vercel env): `SUPABASE_SERVICE_ROLE_KEY`, used solely by `api/invite-user.ts`, which first verifies the caller's JWT and that their profile role is `admin`, validates email/role, restricts `redirectTo` to this deployment's host (or `SITE_URL`), and sets the role in trusted code (not user metadata).
- `.env`, `.env.local` are git-ignored; `.env.example` has placeholders.

## Required Supabase dashboard settings (not codified in SQL)
1. **Authentication → Providers → Email: disable "Allow new users to sign up"** (invite-only). *Why it matters:* the first profile becomes admin, so an open sign-up on a fresh database would let a stranger become owner.
2. Create the owner account first (Authentication → Users → Add user), *then* invite staff from the app.
3. Authentication → URL configuration: Site URL = your Vercel URL; add `<url>/reset-password` to redirect URLs.
4. Set a password policy (≥ 8 chars is enforced client-side only for the reset form; enforce server-side in Auth settings).
5. Enable email confirmations / configure SMTP for production (Supabase's default mailer is rate-limited).

## What has and has not been verified
- ✅ RLS policies, grants, triggers and RPC authorization were exercised with 33 SQL tests running the real migrations in PGlite (embedded Postgres) as `anon`, staff and admin, including: staff cannot import/edit/self-promote, anon is denied everywhere, last admin protected, audit log admin-only, wildcard search escaping.
- ⚠️ PGlite is not Supabase: GoTrue, PostgREST, JWT claim plumbing (`request.jwt.claims`) and Supabase's pre-installed roles/privileges are **stubbed**. The policies must be re-tested on a real Supabase project (dev) before production.
- 🟡 `api/invite-user.ts`: its authorization and validation branches (no token, bad session, staff caller, invalid input, foreign redirect host, admin promotion, existing account) are unit-tested with a **mocked** Supabase client (15 tests). It has never run against a real project, so the actual `inviteUserByEmail` call and email delivery are unverified.
- ⛔ No penetration test, no rate-limit/brute-force test (relies on Supabase Auth's built-in limits).

## Known gaps / recommendations
- No Content-Security-Policy header yet (only `nosniff`, frame-deny, referrer policy).
- No UI for the audit log (data is captured).
- Browser-side import validation is for UX; the RPCs re-validate types/limits, but numeric values inside imported rows are trusted as to *business* correctness (they come from an admin).
- `tax_invoices.items` is JSON; per-item shape is not enforced by a constraint (totals are computed defensively from `amount`).
