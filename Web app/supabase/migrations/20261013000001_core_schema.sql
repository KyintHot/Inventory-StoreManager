-- Ole Hardware Manager — core schema (single company: Ole Honey Flavor Co., Ltd.)
-- Rebuild of the Base44 app. Comet5 remains the system of record: products, sales and
-- tax invoices are imported from Comet5 exports; this app reports on them.
-- Conventions: money = numeric(14,2), quantities = numeric(14,3), all objects schema-qualified,
-- every function sets search_path = '' and is explicitly granted (see 0003 migration).

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users). role: 'admin' (owner/admin) | 'user' (staff, read-only)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- products — imported from Comet5; stock_state / restock_qty are derived by the database
-- so every consumer (dashboard, inventory, exports) agrees.
-- critical: stock <= 20% of reorder point; low: stock <= reorder point; ok otherwise
-- (a reorder point of 0 or less disables alerts) — rule carried over from Base44.
-- ---------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  sku          text not null,
  name_th      text not null default '',
  name_en      text not null default '',
  category     text not null default '',
  unit         text not null default '',
  unit_price   numeric(14,2) not null default 0 check (unit_price >= 0),
  cost_price   numeric(14,2) not null default 0 check (cost_price >= 0),
  stock_qty    numeric(14,3) not null default 0,
  min_stock    numeric(14,3) not null default 0 check (min_stock >= 0),
  restock_qty  numeric(14,3) generated always as (greatest(0, min_stock - stock_qty)) stored,
  stock_state  text generated always as (
    case
      when min_stock <= 0 then 'ok'
      when stock_qty <= min_stock * 0.2 then 'critical'
      when stock_qty <= min_stock then 'low'
      else 'ok'
    end
  ) stored,
  supplier     text not null default '',
  is_active    boolean not null default true,
  source_file  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint products_sku_not_blank check (btrim(sku) <> ''),
  constraint products_sku_unique unique (sku)
);
create index products_category_idx on public.products (category);
create index products_state_qty_idx on public.products (stock_state, stock_qty);

-- Stock history: who/what changed on-hand quantity (new vs Base44; read-only ledger).
create table public.product_stock_history (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  sku         text not null,
  old_qty     numeric(14,3),
  new_qty     numeric(14,3) not null,
  delta       numeric(14,3) not null,
  source      text not null check (source in ('import', 'manual', 'initial')),
  actor       uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index product_stock_history_product_idx on public.product_stock_history (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- sales — one row per sale line from Comet5. Immutable once imported.
-- line_key makes re-importing the same file idempotent (Base44 duplicated rows).
-- ---------------------------------------------------------------------------
create table public.sales (
  id             uuid primary key default gen_random_uuid(),
  line_key       text not null,
  bill_no        text not null check (btrim(bill_no) <> ''),
  sale_date      date not null,
  sku            text not null check (btrim(sku) <> ''),
  product_name   text not null default '',
  qty            numeric(14,3) not null,
  unit           text not null default '',
  unit_price     numeric(14,2) not null default 0,
  amount         numeric(14,2) not null default 0,
  customer_name  text not null default '',
  source         text not null default 'comet5',
  source_file    text not null default '',
  created_at     timestamptz not null default now(),
  constraint sales_line_key_unique unique (line_key)
);
create index sales_sale_date_idx on public.sales (sale_date desc);
create index sales_sku_idx on public.sales (sku);
create index sales_bill_no_idx on public.sales (bill_no);
create index sales_customer_idx on public.sales (customer_name);

-- ---------------------------------------------------------------------------
-- tax_invoices — header + line items (jsonb array). Totals are recomputed by trigger,
-- never trusted from the client.
-- ---------------------------------------------------------------------------
create table public.tax_invoices (
  id                uuid primary key default gen_random_uuid(),
  doc_no            text not null check (btrim(doc_no) <> ''),
  doc_date          date not null,
  customer_name     text not null default '',
  customer_tax_id   text not null default '',
  customer_address  text not null default '',
  customer_branch   text not null default '',
  items             jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  subtotal          numeric(14,2) not null default 0,
  discount          numeric(14,2) not null default 0 check (discount >= 0),
  vat_rate          numeric(5,2) not null default 7 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount        numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  note              text not null default '',
  status            text not null default 'imported' check (status in ('imported', 'edited', 'exported')),
  source            text not null default 'comet5',
  source_file       text not null default '',
  edited_by         text not null default '',
  edited_at         timestamptz,
  exported_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tax_invoices_doc_no_unique unique (doc_no)
);
create index tax_invoices_doc_date_idx on public.tax_invoices (doc_date desc);
create index tax_invoices_status_idx on public.tax_invoices (status);

-- ---------------------------------------------------------------------------
-- company_profile — singleton printed on tax invoices; VAT rate default
-- ---------------------------------------------------------------------------
create table public.company_profile (
  id            smallint primary key default 1 check (id = 1),
  name_th       text not null default '',
  name_en       text not null default '',
  tax_id        text not null default '',
  branch        text not null default '',
  address       text not null default '',
  phone         text not null default '',
  email         text not null default '',
  vat_rate      numeric(5,2) not null default 7 check (vat_rate >= 0 and vat_rate <= 100),
  invoice_note  text not null default '',
  logo_url      text not null default '',
  updated_at    timestamptz not null default now()
);
insert into public.company_profile (id, name_th, name_en)
values (1, 'บริษัท โอเล่ รสน้ำผึ้ง จำกัด', 'Ole Honey Flavor Co., Ltd.');

create table public.monthly_targets (
  id             uuid primary key default gen_random_uuid(),
  year           integer not null check (year between 2000 and 2200),
  month          integer not null check (month between 1 and 12),
  target_amount  numeric(14,2) not null default 0 check (target_amount >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint monthly_targets_year_month_unique unique (year, month)
);

create table public.sync_logs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('products', 'sales', 'invoices')),
  file_name      text not null default '',
  row_count      integer not null default 0,
  created_count  integer not null default 0,
  updated_count  integer not null default 0,
  skipped_count  integer not null default 0,
  imported_by    text not null default '',
  note           text not null default '',
  created_at     timestamptz not null default now()
);
create index sync_logs_created_idx on public.sync_logs (created_at desc);

-- Audit log: append-only record of sensitive changes; readable by admins only.
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index audit_logs_table_idx on public.audit_logs (table_name, created_at desc);
