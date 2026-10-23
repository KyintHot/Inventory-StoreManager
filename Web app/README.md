# Ole Hardware Manager

Rebuild of the Base44 app *Ole Hardware Manager* as a React + TypeScript + Supabase web app, deployable on Vercel. A bilingual (EN/TH) companion to Comet5: import products, sales and tax invoices, then review sales, stock/restock needs and print or correct tax invoices.

> Status: built, tested, and smoke-checked against a live Supabase project. Not deployed to Vercel yet — see `docs/progress.md` for exactly what is and isn't verified.

## License
MIT — see [LICENSE](LICENSE).

## Run locally
Requirements: Node 20+ (developed on Node 26), a Supabase project.

```bash
npm install
cp .env.example .env     # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```
Without a configured `.env` the app shows a "Supabase is not configured" screen instead of failing silently.

### Set up Supabase (dev project first)
1. Create a project. In **SQL Editor** run, in filename order, every file in `supabase/migrations/` (or use the Supabase CLI: `supabase link` + `supabase db push`). The last one grants the service role execution on the RPCs — without it server-side callers get `permission denied`. `npm run smoke:live` then verifies the project.
2. **Authentication → Providers → Email → turn OFF "Allow new users to sign up".** The first user created becomes the owner/admin, so do this before anything else.
3. **Authentication → Users → Add user**: create the owner (email + password). They become admin automatically.
4. **Authentication → URL Configuration**: Site URL = your app URL; add `<app URL>/reset-password` to Redirect URLs.
5. Sign in, then use **Team → Invite** for staff (needs the Vercel function, see below) or add users in the dashboard (they default to Staff).

### Load your data
Sign in as owner → **Import from Comet5**. Import in this order: *Products & stock*, *Sales*, *Tax invoices*. CSV templates: `public/templates/*.csv`. Re-importing the same file is safe (sales are keyed; corrected invoices are kept).

## Commands
| | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run typecheck` | strict TypeScript |
| `npm test` | Vitest: unit + SQL/RLS tests (PGlite) |
| `npm run e2e` | Playwright UI tests in Chrome against a stubbed API |
| `npm run build` | production build to `dist/` |

## Deploy to Vercel
1. Push the repo to GitHub and import it in Vercel (framework preset: Vite; `vercel.json` is included).
2. Environment variables (Project → Settings → Environment Variables):

| Name | Value | Exposed to browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | project URL | yes (public) |
| `VITE_SUPABASE_ANON_KEY` | publishable/anon key | yes (public) |
| `SUPABASE_URL` | project URL | no |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | **no — server only, never prefix with `VITE_`** |
| `SITE_URL` (optional) | your production URL, if it differs from the request host | no |

3. Deploy, then update Supabase Auth Site URL / Redirect URLs to the Vercel domain.
4. Use separate Supabase projects for preview/dev and production. Never run destructive SQL against production without a backup (Supabase → Database → Backups).

## Documentation
`docs/base44-audit.md` · `feature-inventory.md` · `architecture.md` · `data-model.md` · `security-plan.md` · `implementation-plan.md` · `progress.md` · `CLAUDE.md` (conventions for future sessions)

## Known limitations
- Google sign-in and public registration are intentionally not included (see audit) — invitations are the only way accounts are created.
- No purchase orders / POS / supplier module — the original has none and Comet5 remains the source of truth.
- Row types are hand-written; regenerate with `supabase gen types` after the project exists.

## Tests use synthetic data
The Comet5 `.xls` fixtures in `tests/fixtures/comet5/` are generated, not real invoices: every company, customer, address, phone number and tax ID in them is invented. They reproduce both real-world quirks the importer must survive (Thai text stored as Windows-874 bytes under a wrong codepage, and a printed invoice page rather than a table). Regenerate them with `node scripts/make-fixtures.mjs`.
