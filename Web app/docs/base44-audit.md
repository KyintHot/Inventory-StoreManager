# Base44 audit — "Ole Hardware Manager"

Reference: https://ole-hardware-flow.base44.app/ (inspected 2026-10-13)

## What could and could not be inspected

| Source | Inspected? | Notes |
| --- | --- | --- |
| Login page (rendered) | Yes | Viewed in the built-in browser. |
| Authenticated screens (Overview, Inventory, Sales, Invoices, Import, Team, Settings) | **No — never rendered** | The app requires a login. No credentials were available, and creating an account / signing in on the owner's behalf is not something the assistant may do. |
| Public front-end JavaScript bundle (`/assets/index-*.js`) | Yes — read-only | Routes, entity names, field names, queries, validation, i18n strings, import column aliases, status/threshold rules and theme tokens were read from it. |
| Base44 backend (entity security rules, automations, stored data) | **No** | Not exposed to the browser. Row-level rules and any server functions in Base44 are unknown. |

**Consequence:** feature parity below is *derived from the shipped client code*, not from a side-by-side visual comparison of authenticated screens. Visual layout of the rebuilt pages follows the original's class names/theme tokens and structure where legible, but exact pixel/visual parity is **not claimed**.

## The application, as found

A bilingual (EN/TH) companion to **Comet5** (Thai accounting/ERP) for *Ole Honey Flavor Co., Ltd.* It **reports on** data exported from Comet5. It is not a POS, has no purchasing, no suppliers module, no stock ledger.

### Routes
`/login`, `/register`, `/forgot-password`, `/reset-password`, `/` (Overview), `/inventory`, `/sales`, `/invoices`, `/invoices/:id`, `/import`, `/team`, `/settings`.

### Entities (Base44 → this rebuild)
| Base44 entity | Purpose | Rebuild table |
| --- | --- | --- |
| `User` (built-in; `role` admin/user, `full_name`, `email`) | Accounts and access level | `auth.users` + `public.profiles` |
| `Product` | sku, name_th, name_en, category, unit, unit_price, cost_price, stock_qty, min_stock, restock_qty, stock_state, supplier, is_active, source_file | `products` |
| `Sale` | One row per Comet5 sale line: bill_no, sale_date, sale_month, sku, product_name, qty, unit, unit_price, amount, customer_name, source, source_file | `sales` |
| `TaxInvoice` | doc_no, doc_date, customer_*, items[], subtotal, discount, vat_rate, vat_amount, total, note, status, source, edited_by/at, exported_at | `tax_invoices` |
| `CompanyProfile` | name_th/en, tax_id, branch, address, phone, email, vat_rate, invoice_note, logo_url | `company_profile` (singleton) |
| `MonthlyTarget` | year, month, target_amount | `monthly_targets` |
| `SyncLog` | kind, file_name, row_count, imported_by, note | `sync_logs` |

### Pages and behaviour found in the client code
- **Overview**: this-month revenue / units / bills; reorder-item count; monthly target progress (achieved / remaining); revenue-by-month bars (latest 6 months with sales); top-5 best sellers (all-time, by revenue); top-5 restock list; last import line.
- **Inventory & restock**: search (SKU/TH/EN name), category filter, stock-level filter (all / only alerts / critical / low / ok) with counts, load-more paging (50), admin-only edit dialog, admin-only "Export restock list" (.xlsx), responsive table ↔ cards.
- **Sales history**: totals (revenue/units/bills), search (bill no., SKU, product, customer), date range, *Transactions* and *By customer* tabs (top 40), load-more paging.
- **Tax invoices**: list with search + status filter (imported/edited/exported); invoice page with a correction form (customer, tax id, branch, date, address, line items add/remove, discount, VAT rate, note), live totals, printable Thai/EN tax-invoice sheet; admin-only Save and "Export corrected file" (.xlsx, one row per line, marks *exported*).
- **Import from Comet5**: 3 types (products, sales, tax invoices); CSV/XLSX; TIS-620-fallback decoding; automatic column matching by Thai/English aliases; manual remap; preview + row problems; admin only; logs to SyncLog.
- **Team**: admin-only invite by email with role; change member role.
- **Settings**: admin-only company details (printed on invoices), VAT rate default, monthly targets by year/month.
- **Language**: EN/TH switch, persisted.
- **Auth**: email+password, "Continue with Google", forgot/reset password, public "Create one" registration.

### Business rules found
- `restock_qty = max(0, min_stock − stock_qty)`.
- `stock_state`: `min_stock ≤ 0` → ok; `stock ≤ 20 % × min_stock` → critical; `stock ≤ min_stock` → low; else ok.
- Invoice totals: `subtotal = Σ line amounts`; `net = max(0, subtotal − discount)`; `VAT = net × rate / 100`; `total = net + VAT`.
- Line amount = qty × unit price when qty/price edited; amount editable directly.
- Dates in imports: Buddhist-era years (> 2400) converted by −543; `d/m/y` order; Excel serials supported.
- Staff (`user`) are view-only; admins import, edit products/invoices, manage team and settings.
- Currency is THB (฿), VAT default 7 %.

### Defects / risks found in the original (documented, fixed in the rebuild)
1. **"Bills" counted sale *lines*, not bills** (dashboard, sales totals, per-customer). → counts distinct bill numbers.
2. **Re-importing a sales file duplicated every line** (`bulkCreate`, no key). → deterministic `line_key`, idempotent upsert.
3. **Re-importing invoices silently overwrote corrections/exported status.** → edited/exported invoices are kept and reported.
4. **Product import wiped existing text fields with blanks** when a column wasn't mapped. → blanks mean "keep existing".
5. **Column auto-matcher let `unit`/`หน่วย` claim the "Unit Price"/"ราคาต่อหน่วย" column** (substring fallback ran per field in order). → exact matches first, substring fallback second (covered by a regression test).
6. **Invoice totals computed only in the browser** and written back. → recomputed by a database trigger.
7. Staff access was enforced by hiding UI and by Base44 rules whose definition is unknown. → explicit Postgres RLS + RPC checks.
8. Public registration was open on the login page. → invite-only (see `docs/security-plan.md`).
9. Whole-file import with no upper bound or progress. → size/row limits, chunking, progress, partial-failure reporting.

### Not reproduced (and why)
- **"Continue with Google"** — requires configuring a Google OAuth client in Supabase. Not enabled; straightforward to add later (`supabase.auth.signInWithOAuth`).
- **Public "Create one" registration / `/register`** — deliberately removed (company app; see security plan).
- **Legacy `.xls` upload** — the original accepted it via a bundled spreadsheet library with known security advisories. The rebuild accepts `.csv` and `.xlsx` and tells the user to re-save `.xls` as `.xlsx`.
- **Company logo image** — original used a Base44-hosted image URL. The rebuild uses an SVG mark; `company_profile.logo_url` exists but there is no upload UI yet.
