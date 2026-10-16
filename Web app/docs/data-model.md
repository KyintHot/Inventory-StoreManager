# Data model

Source: `supabase/migrations/20261013000001_core_schema.sql`, `…0002_functions_triggers.sql`, `…0003_rls_grants.sql`. Single company, so no tenant column; ownership is "everyone with a profile belongs to the company".

Money is `numeric(14,2)`, quantities `numeric(14,3)`; no floating point in the database.

| Table | Key points |
| --- | --- |
| `profiles` | `id` → `auth.users`, `email`, `full_name`, `role ∈ {admin,user}`. Created by trigger on user creation: **first profile ever = admin**, others `user`. Role is never read from client metadata. |
| `products` | `sku` unique and non-blank. `restock_qty` and `stock_state` are **generated stored columns**. `cost_price` imported, unused. |
| `product_stock_history` | Append-only ledger written by trigger when `stock_qty` changes (`initial`, `import`, `manual`), with actor and timestamp. |
| `sales` | One row per Comet5 line. `line_key = bill_no|sku|line_no` unique → idempotent re-import. No direct client writes. |
| `tax_invoices` | `doc_no` unique. `items jsonb` (array of `{sku, description, qty, unit, unit_price, amount}`). `subtotal/vat_amount/total` recomputed by trigger. `status ∈ {imported,edited,exported}`. |
| `company_profile` | Singleton (`id = 1` check). Seeded with the company name only. |
| `monthly_targets` | `unique(year, month)`, `month 1–12`. |
| `sync_logs` | Import history written by `record_import`. |
| `audit_logs` | Trigger-written old/new JSON for products, invoices, company, targets, profiles. Admin read only. |

## Rules implemented in SQL
- `restock_qty = greatest(0, min_stock − stock_qty)`
- `stock_state`: `min_stock ≤ 0` → `ok`; `stock ≤ 0.2·min` → `critical`; `stock ≤ min` → `low`; else `ok`.
- Invoice: `subtotal = Σ amount`; `net = max(0, subtotal − discount)`; `vat = round(net·rate/100, 2)`; `total = net + vat`.
- Last-admin protection on demotion and deletion.
- Stock may be negative (Comet5 can report it); price, cost and reorder point may not.

## RPC surface (all `search_path = ''`)
Read (invoker, RLS applies): `products_filtered`, `product_categories`, `inventory_alert_counts`, `sales_filtered`, `sales_summary`, `sales_by_customer`, `dashboard_summary`, `like_pattern`.
Write (definer, admin-checked): `import_products`, `import_sales`, `import_invoices`, `record_import`, `save_invoice`, `mark_invoice_exported`, `set_monthly_target`.
Helpers: `is_admin`, `is_member`, `require_admin`.

## Definitions of reported numbers
| Number | Definition |
| --- | --- |
| Revenue (this month) | Σ `sales.amount` where `sale_date` in the month (Comet5 line value; whatever Comet5 exported — taxes/discounts as Comet5 reports them). |
| Units | Σ `sales.qty` (credit-note lines with negative qty reduce it). |
| Bills | `count(distinct bill_no)` (Base44 counted lines — fixed). |
| Revenue by month | Latest 6 calendar months **that have sales**, oldest first. |
| Best sellers | Top 5 SKUs by Σ amount, **all time** (as in Base44). |
| Items to reorder | Products with `stock_state ∈ {critical, low}`. |
| Target achieved | revenue ÷ `monthly_targets.target_amount` (bar capped at 100 %). |

## Migration of existing data
Base44 data export was not available to the assistant. Use the app's own Import page (Products, then Sales, then Tax invoices) with the original Comet5 exports, or the CSV templates in `public/templates/`. Imports are idempotent and report created / updated / skipped rows. Nothing is imported automatically.
