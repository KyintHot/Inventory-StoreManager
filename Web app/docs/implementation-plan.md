# Implementation plan and decisions

## Scope decision (made with the owner, 2026-10-13)
The master prompt described a general inventory/POS/purchasing system. Inspection of the Base44 app showed it is a **read-and-report companion to Comet5**. The owner chose **"faithful rebuild first"**: recreate the 7 real screens exactly, fix documented defects, add only low-conflict improvements (stock history, audit log, exports, tests). POS, purchase orders, suppliers, returns, stock counts, warehouses etc. are **not built** because Comet5 stays the source of truth and a second ledger would produce conflicting numbers. Revisit if the business stops using Comet5.

Also decided: Supabase backend, deploy to Vercel (static SPA + one serverless function), no Supabase project yet (code + SQL only).

## Phases (all complete unless noted)
1. **Inspection & foundation** — audit, architecture, tooling (React 19, TS strict, Vite 8, Tailwind 4, Radix primitives, React Router, TanStack Query, RHF + Zod), schema, RLS. ✅
2. **Products & inventory** — list/filter/edit, derived stock state, stock history. ✅
3. **Sales** — history, summaries, by-customer, export. (No POS — see scope decision.) ✅
4. **Restocking** — restock list/export from reorder points. (No purchase orders — see scope decision.) ✅
5. **Reporting & polish** — overview, tax invoices, import, team, settings, i18n, responsive, a11y pass. ✅
6. **Validation** — typecheck, build, unit/SQL/UI tests, responsive sweep. ✅ for what is testable offline; see `progress.md` for what is outstanding (live Supabase).

## Library decisions
| Prompt asked for | Used | Why |
| --- | --- | --- |
| shadcn/ui | shadcn-style primitives hand-written over Radix | avoids interactive CLI; same patterns and tokens |
| TanStack Table | not used | tables are simple, server-paginated lists; a table engine would add weight without benefit |
| date-fns | not used (removed) | native `Intl`/`Date` cover the few formats needed (`src/utils/format.ts`) |
| `@vercel/node` types | removed | only two type names were used; it pulled in dev-dependency advisories. Minimal local interfaces in `api/invite-user.ts` |
| SheetJS (`xlsx`) as in Base44 | `read-excel-file` + `write-excel-file` + `papaparse` | the npm `xlsx` package is unmaintained on npm and has known advisories; user-uploaded files are untrusted input. Trade-off: `.xls` not supported |
| Recharts | Recharts, lazy-loaded | only the Overview needs it |
| Supabase CLI types | hand-written `src/types/database.ts` | no project to generate from yet |
| Playwright | Playwright with the installed Chrome, against a stubbed Supabase API | no browser download; no backend available |

## Theme decision
The prompt suggested a blue/indigo accent; the original uses deep maroon + honey gold with Kanit/Noto Sans Thai. The original is the source of truth, so its palette is kept. Green/orange/red status colours are used for ok / low / critical.
