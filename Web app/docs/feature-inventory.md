# Feature inventory

Legend — **Origin**: *Existing* = found in the Base44 client code; *Fix* = Base44 defect corrected; *New* = proposed enhancement. **Status**: ✅ implemented and covered by an executed test; 🟡 implemented, not covered by an automated test; ⛔ not implemented.
"Tested" refers to automated tests actually run (see `docs/progress.md`). Nothing has been run against a live Supabase project yet.

## Existing features (recreated)
| Feature | Status | Verified by |
| --- | --- | --- |
| Email/password login, logout, session persistence | ✅ | UI tests (stubbed API) |
| Forgot / reset password pages | ✅ (UI) 🟡 (real email flow needs a Supabase project) | UI test (request only) |
| Protected routes; admin-only routes | ✅ | UI tests |
| EN/TH language switch (persisted) | ✅ | UI test |
| Overview: KPIs, target progress, monthly chart, best sellers, restock list, last import | ✅ | UI tests; SQL tests for `dashboard_summary` |
| Inventory list: search, category, stock-level filters, counts, load more | ✅ | UI tests; SQL tests for `products_filtered` |
| Inventory: admin edit dialog (name TH/EN, category, unit, price, stock, reorder point) | ✅ | UI tests; SQL RLS tests |
| Inventory: restock list export (.xlsx) | 🟡 | – |
| Sales history: totals, search, date range, by-customer tab, load more | ✅ | UI tests; SQL tests |
| Tax invoices: list, search, status filter | ✅ | UI tests |
| Tax invoice page: correction form, live totals, printable sheet | ✅ | UI tests; SQL trigger tests; print layout 🟡 (visual only) |
| Invoice export (.xlsx per line) + mark exported | ✅ | UI test (download + status); SQL tests |
| Import from Comet5: products / sales / invoices, auto column map, remap, preview, problem list, admin only, import log | ✅ | Unit tests for mapping/validation; UI test (products); SQL RPC tests |
| Team: invite by email with role; change role | ✅ role change (UI + RLS); 🟡 invite (endpoint logic unit-tested with mocked Supabase; real invite email unverified) | UI test (role change); SQL tests; `tests/unit/inviteUser.test.ts` |
| Settings: company details, VAT rate, monthly targets | ✅ | UI tests |
| Mobile card layouts for tables; mobile drawer navigation | ✅ | Responsive tests at 360/390/768/1024/1440 |
| "Continue with Google" | ⛔ | Needs OAuth setup in Supabase |
| Public registration | ⛔ (intentional) | Invite-only |
| `.xls` upload | ⛔ (intentional) | Use `.xlsx`/`.csv` |

## Fixes to original behaviour
| Fix | Status | Verified by |
| --- | --- | --- |
| Bills = distinct bill numbers | ✅ | SQL tests |
| Idempotent sales re-import | ✅ | SQL tests |
| Edited/exported invoices survive a re-import | ✅ | SQL tests |
| Blank import cells keep existing product data | ✅ | SQL tests + unit tests |
| Column-matcher "unit vs unit price" flaw | ✅ | Unit tests |
| Invoice totals computed server-side | ✅ | SQL tests |
| Impossible calendar dates rejected in import (e.g. 31/02) | ✅ | Unit tests |
| Row-level security instead of UI-only gating | ✅ policies; 🟡 not run on Supabase itself | SQL tests (PGlite) |

## New (proposed enhancements, low conflict with Comet5 as source of truth)
| Feature | Status |
| --- | --- |
| Stock history (who/when/what changed on-hand qty; import vs manual) shown in the edit dialog | ✅ |
| Audit log (admin-readable) for products, invoices, company, targets, profiles | ✅ table + triggers (SQL tests); 🟡 no viewer page yet |
| Sales CSV export (filtered) | 🟡 |
| CSV import templates | 🟡 |
| Last-admin protection (cannot demote/delete the final admin) | ✅ |
| Import partial-failure reporting and progress bar | 🟡 |
| Vercel serverless invite endpoint with server-side role check | 🟡 (unit-tested with mocked Supabase) |

## Deliberately NOT built (from the generic master prompt)
POS/checkout, purchase orders, suppliers module, returns/refunds, stock counts, warehouses, customers module, expenses, notifications page, multi-tenant companies, payment processing. The Base44 app has none of these and Comet5 is the system of record for sales and stock; building them would create a second, conflicting source of truth. They remain possible future work if the business decides to move operations out of Comet5 (decision recorded in `docs/implementation-plan.md`).
