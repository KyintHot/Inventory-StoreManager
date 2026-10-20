# CLAUDE.md — Ole Hardware Manager (Base44 → React + Supabase rebuild)

Bilingual (EN/TH) reporting companion to **Comet5** for Ole Honey Flavor Co., Ltd. Comet5 is the system of record: this app **imports** products/sales/tax invoices and reports on them. It is not a POS — do not add checkout/purchasing/stock-ledger features without an explicit decision (see `docs/implementation-plan.md`).

## Commands
```bash
npm install
cp .env.example .env          # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev                   # http://localhost:5173
npm run typecheck             # tsc (strict, noUncheckedIndexedAccess)
npm test                      # Vitest: tests/unit + tests/db (SQL migrations/RLS in PGlite)
npm run e2e                   # Playwright UI tests (installed Chrome; stubbed Supabase API)
npm run build                 # tsc + vite build -> dist/
```
`npx tsc -p api/tsconfig.json --noEmit` typechecks the Vercel function.

## Architecture rules
- `src/services/*` is the **only** place that talks to Supabase. Components use TanStack Query hooks that call services.
- Business rules live in the database (generated columns, triggers, RPCs). `src/utils/stock.ts` and `invoice.ts` are *previews* mirroring them — change both sides together and keep tests in sync.
- Pure logic goes in `src/utils/` with unit tests (`tests/unit`). Import mapping/validation: `src/utils/importMapping.ts`.
- Success toasts only after the backend confirms. An RLS-filtered update returns 0 rows — treat that as a permission error (see `updateProduct`).
- All user-facing strings go through `src/lib/messages.ts` (EN + TH). Add both languages.
- Forms: React Hook Form + Zod; use `<Field>` (error text is outside the `<label>` on purpose).
- Radix Select cannot have `''` item values — use a sentinel like `'all'`.
- Money is THB, 2 dp; never use floats for money in SQL (`numeric`).

## Database / security
- Migrations in `supabase/migrations/` are applied in filename order; never edit an applied migration — add a new one.
- Every table has RLS; `anon` has no privileges; functions use `search_path = ''` and are granted explicitly (migration 0003, `service_role` in 20261020000001). New functions must be added to those grant lists or they are unusable by clients — `tests/unit/migration-grants.test.ts` enforces this automatically.
- Writes that need privilege go through `SECURITY DEFINER` RPCs that call `public.require_admin()`.
- **Never** put the service-role key in `VITE_*` vars or client code. Only `api/invite-user.ts` uses it.
- Never trust role from client metadata. The first profile created becomes admin → keep public sign-ups disabled in Supabase.
- `tests/db/security.test.ts` runs the real migrations in PGlite with a stubbed `auth` schema. It is **not** a substitute for testing on a real Supabase project.

## Testing workflow
1. `npm run typecheck && npm test` after every change (fast).
2. `npm run e2e` after UI changes (starts Vite on :5199 with a stub backend; screenshots from `e2e/responsive.spec.ts` go to `test-results/screens/`).
3. `npm run build` before declaring done.
Report only what you actually ran. Update `docs/progress.md` after each phase.

## Gotchas
- TypeScript 7 / Vite 8 / Tailwind 4: no `baseUrl` in tsconfig (use relative `paths`); Tailwind is configured in `src/index.css` (`@theme inline`), no `tailwind.config`.
- Windows PowerShell 5.1: **do not edit source with `Get-Content`/`Set-Content`** — it corrupts UTF-8 Thai text into mojibake. Use the editor tools, or `[IO.File]::ReadAllText/WriteAllText` with UTF-8.
- The Base44 reference app needs a login; only its public client bundle was inspected. See `docs/base44-audit.md` for what is derived vs verified.
