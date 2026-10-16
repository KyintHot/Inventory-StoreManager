# Architecture

```
Browser (React SPA, Vite)                    Vercel                       Supabase
┌──────────────────────────┐   static files  ┌───────────────┐
│ React Router + TanStack  │◄────────────────│ dist/ (SPA)   │
│ Query + React Hook Form  │                 │ vercel.json   │
│ + Zod, Tailwind, Radix   │   /api/*        ├───────────────┤
│                          │────────────────►│ api/invite-   │──service key──► Auth Admin API
│ supabase-js (anon key)   │                 │ user.ts       │               (invite only)
└────────────┬─────────────┘                 └───────────────┘
             │ JWT (user session)
             ▼
   PostgREST ── RLS policies ── Postgres: tables, generated columns, triggers, RPC functions
   Supabase Auth (email+password, invite, recovery)
```

## Principles
1. **Comet5 is the system of record.** The app imports exports, reports on them and lets admins correct tax invoices and reorder points. Nothing here originates sales or moves stock.
2. **The database is authoritative.** Stock state, restock quantity and invoice totals are derived in Postgres (generated columns / trigger). The browser mirrors them only for live previews (`src/utils/stock.ts`, `src/utils/invoice.ts`) and the database result replaces the preview after save.
3. **Authorization lives in Postgres.** RLS policies + `SECURITY DEFINER` RPCs that call `require_admin()`. React route guards are convenience only.
4. **No service-role key in the browser.** The only privileged operation (invite) is a Vercel function.

## Source layout
```
src/
  app/            App shell wiring: router, QueryClient, 404
  components/     ui/ (shadcn-style primitives), layout/ (AppShell, guards), states, shared
  features/       auth/ dashboard/ inventory/ sales/ invoices/ import/ team/ settings/
  lib/            supabase client, i18n + messages (EN/TH), error classification, utils
  services/       one file per backend area; the ONLY place that calls supabase
  types/          hand-maintained row types mirroring the migrations
  utils/          pure logic: importMapping, invoice, stock, format, readTable, exportFile
api/              Vercel serverless functions
supabase/migrations/   versioned SQL (apply in order)
tests/            unit/ (Vitest) and db/ (Vitest + PGlite: migrations, RLS, RPCs)
e2e/              Playwright UI tests against a stubbed Supabase HTTP API
docs/
```

## Data flow conventions
- Reads: `useQuery` / `useInfiniteQuery` → `services/*` → PostgREST table or RPC. Lists use RPCs (`products_filtered`, `sales_filtered`) so search wildcards are escaped in one place; pagination is offset-based with a +1 look-ahead row.
- Writes: `useMutation` → RPC (imports, invoice save/export, targets) or an RLS-protected table update (products, profiles, company, target delete). Success toasts are shown **only after** the server confirms; an update that affects 0 rows (RLS filtered it) is surfaced as a permission error, not success.
- After a mutation the affected query keys are invalidated (`products`, `alert-counts`, `dashboard`, …).
- Errors are classified in `lib/errors.ts` (forbidden / session / network / conflict / generic); an expired session signs the user out via the query cache's global handler.
- Imports: parse → map → validate in the browser (`utils/importMapping.ts`) → send in chunks of 500 (invoices 100) to idempotent admin RPCs → record in `sync_logs`.

## Costing / profit
Not applicable: the Base44 app reports revenue only. `products.cost_price` is imported and stored but not used in any calculation. No profit figure is shown anywhere (revenue is never labelled profit).

## Deployment shape
Static SPA + one serverless function on Vercel; Supabase hosts Auth and Postgres. `vercel.json` rewrites everything except `/api/*` to `index.html` and sets basic security headers.
