-- Helpers, triggers and RPCs. All functions use search_path = '' and fully-qualified names.
-- Read RPCs are SECURITY INVOKER (RLS applies). Write RPCs are SECURITY DEFINER and check
-- public.is_admin() themselves; direct table writes for imports are not granted to clients.

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only owners and admins can do this' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger tax_invoices_touch before update on public.tax_invoices
  for each row execute function public.touch_updated_at();
create trigger company_profile_touch before update on public.company_profile
  for each row execute function public.touch_updated_at();
create trigger monthly_targets_touch before update on public.monthly_targets
  for each row execute function public.touch_updated_at();

-- New auth user -> profile. The first profile ever created becomes the owner (admin);
-- everyone else is 'user'. Role is NEVER read from client-controlled metadata.
-- Keep public sign-ups disabled in Supabase Auth settings (invite-only company app).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'user' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Protect role/email: only admins change roles; the last admin cannot be demoted.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Only owners and admins can change access levels' using errcode = '42501';
    end if;
  end if;
  if old.role = 'admin' and new.role <> 'admin' then
    if not exists (select 1 from public.profiles p where p.role = 'admin' and p.id <> old.id) then
      raise exception 'At least one owner/admin is required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.guard_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and not exists (
    select 1 from public.profiles p where p.role = 'admin' and p.id <> old.id
  ) then
    raise exception 'At least one owner/admin is required' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger profiles_guard_delete before delete on public.profiles
  for each row execute function public.guard_profile_delete();

-- Tax invoice totals are always derived from items on the server.
create or replace function public.compute_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_net numeric;
begin
  new.subtotal := coalesce(
    (select sum(coalesce(nullif(i ->> 'amount', '')::numeric, 0))
       from jsonb_array_elements(new.items) i), 0);
  new.discount := coalesce(new.discount, 0);
  v_net := greatest(0, new.subtotal - new.discount);
  new.vat_amount := round(v_net * coalesce(new.vat_rate, 0) / 100, 2);
  new.total := v_net + new.vat_amount;
  return new;
end;
$$;
create trigger tax_invoices_totals before insert or update on public.tax_invoices
  for each row execute function public.compute_invoice_totals();

-- Stock history ledger (written by trigger only).
create or replace function public.log_stock_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := coalesce(nullif(current_setting('app.stock_source', true), ''), 'manual');
begin
  if tg_op = 'INSERT' then
    insert into public.product_stock_history (product_id, sku, old_qty, new_qty, delta, source, actor)
    values (new.id, new.sku, null, new.stock_qty, new.stock_qty, 'initial', auth.uid());
  elsif new.stock_qty is distinct from old.stock_qty then
    insert into public.product_stock_history (product_id, sku, old_qty, new_qty, delta, source, actor)
    values (new.id, new.sku, old.stock_qty, new.stock_qty, new.stock_qty - old.stock_qty, v_source, auth.uid());
  end if;
  return null;
end;
$$;
create trigger products_stock_history after insert or update of stock_qty on public.products
  for each row execute function public.log_stock_change();

-- Audit trail
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (table_name, row_id, action, old_data, new_data, actor)
  values (
    tg_table_name,
    v_row ->> 'id',
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return null;
end;
$$;
create trigger products_audit after update or delete on public.products
  for each row execute function public.audit_row();
create trigger tax_invoices_audit after update or delete on public.tax_invoices
  for each row execute function public.audit_row();
create trigger company_profile_audit after insert or update or delete on public.company_profile
  for each row execute function public.audit_row();
create trigger monthly_targets_audit after insert or update or delete on public.monthly_targets
  for each row execute function public.audit_row();
create trigger profiles_audit after update or delete on public.profiles
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Read RPCs (SECURITY INVOKER — row level security applies)
-- ---------------------------------------------------------------------------
create or replace function public.like_pattern(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create or replace function public.products_filtered(
  p_search text default '',
  p_category text default '',
  p_state text default 'all'
)
returns setof public.products
language sql
stable
set search_path = ''
as $$
  select p.*
  from public.products p
  where (btrim(coalesce(p_search, '')) = ''
         or p.sku ilike public.like_pattern(p_search)
         or p.name_th ilike public.like_pattern(p_search)
         or p.name_en ilike public.like_pattern(p_search))
    and (coalesce(p_category, '') = '' or p.category = p_category)
    and (case coalesce(p_state, 'all')
           when 'all' then true
           when 'alerts' then p.stock_state in ('critical', 'low')
           else p.stock_state = p_state
         end);
$$;

create or replace function public.product_categories()
returns setof text
language sql
stable
set search_path = ''
as $$
  select distinct p.category from public.products p where p.category <> '' order by 1;
$$;

create or replace function public.inventory_alert_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'critical', count(*) filter (where stock_state = 'critical'),
    'low',      count(*) filter (where stock_state = 'low')
  ) from public.products;
$$;

create or replace function public.sales_filtered(
  p_from date default null,
  p_to date default null,
  p_search text default ''
)
returns setof public.sales
language sql
stable
set search_path = ''
as $$
  select s.*
  from public.sales s
  where (p_from is null or s.sale_date >= p_from)
    and (p_to is null or s.sale_date <= p_to)
    and (btrim(coalesce(p_search, '')) = ''
         or s.bill_no ilike public.like_pattern(p_search)
         or s.sku ilike public.like_pattern(p_search)
         or s.product_name ilike public.like_pattern(p_search)
         or s.customer_name ilike public.like_pattern(p_search));
$$;

-- "Bills" = distinct bill numbers (Base44 counted lines under this label; documented fix).
create or replace function public.sales_summary(
  p_from date default null,
  p_to date default null,
  p_search text default ''
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'revenue', coalesce(sum(amount), 0),
    'units',   coalesce(sum(qty), 0),
    'bills',   count(distinct bill_no),
    'lines',   count(*)
  ) from public.sales_filtered(p_from, p_to, p_search);
$$;

create or replace function public.sales_by_customer(
  p_from date default null,
  p_to date default null,
  p_limit integer default 40
)
returns table (customer_name text, bills bigint, units numeric, revenue numeric)
language sql
stable
set search_path = ''
as $$
  select s.customer_name,
         count(distinct s.bill_no) as bills,
         coalesce(sum(s.qty), 0) as units,
         coalesce(sum(s.amount), 0) as revenue
  from public.sales s
  where (p_from is null or s.sale_date >= p_from)
    and (p_to is null or s.sale_date <= p_to)
  group by s.customer_name
  order by revenue desc, s.customer_name
  limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;

create or replace function public.dashboard_summary(p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_month jsonb;
  v_trend jsonb;
  v_top   jsonb;
  v_alerts jsonb;
  v_counts jsonb;
  v_target jsonb;
  v_log   jsonb;
begin
  select jsonb_build_object(
           'revenue', coalesce(sum(amount), 0),
           'units',   coalesce(sum(qty), 0),
           'bills',   count(distinct bill_no))
    into v_month
    from public.sales where sale_date >= v_start and sale_date < v_end;

  -- latest 6 months that have sales, oldest first
  select coalesce(jsonb_agg(jsonb_build_object('month', m, 'revenue', r) order by m), '[]'::jsonb)
    into v_trend
    from (
      select to_char(date_trunc('month', sale_date), 'YYYY-MM') as m, sum(amount) as r
      from public.sales
      group by 1
      order by 1 desc
      limit 6
    ) t;

  -- all-time best sellers (matches Base44)
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', t.sku,
           'name_th', coalesce(nullif(p.name_th, ''), nullif(p.name_en, ''), t.product_name, ''),
           'name_en', coalesce(nullif(p.name_en, ''), nullif(p.name_th, ''), t.product_name, ''),
           'qty', t.qty,
           'revenue', t.revenue) order by t.revenue desc), '[]'::jsonb)
    into v_top
    from (
      select s.sku, max(s.product_name) as product_name, sum(s.qty) as qty, sum(s.amount) as revenue
      from public.sales s group by s.sku order by sum(s.amount) desc limit 5
    ) t
    left join public.products p on p.sku = t.sku;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.stock_qty), '[]'::jsonb)
    into v_alerts
    from (
      select id, sku, name_th, name_en, unit, stock_qty, min_stock, restock_qty, stock_state
      from public.products where stock_state in ('critical', 'low')
      order by stock_qty limit 5
    ) a;

  v_counts := public.inventory_alert_counts();

  select to_jsonb(t) into v_target
    from (select year, month, target_amount from public.monthly_targets
          where year = p_year and month = p_month) t;

  select to_jsonb(l) into v_log
    from (select kind, file_name, row_count, created_at from public.sync_logs
          order by created_at desc limit 1) l;

  return jsonb_build_object(
    'revenue', v_month -> 'revenue',
    'units',   v_month -> 'units',
    'bills',   v_month -> 'bills',
    'trend',   v_trend,
    'topSkus', v_top,
    'alerts',  v_alerts,
    'alertCount', coalesce((v_counts ->> 'critical')::int, 0) + coalesce((v_counts ->> 'low')::int, 0),
    'target',  v_target,
    'lastLog', v_log
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Import RPCs (SECURITY DEFINER, admin only). Clients send validated rows in chunks.
-- ---------------------------------------------------------------------------
create or replace function public.import_products(p_rows jsonb, p_file_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_updated integer;
begin
  perform public.require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Rows must be an array of at most 2000 items' using errcode = '22023';
  end if;
  perform set_config('app.stock_source', 'import', true);

  with src as (
    select distinct on (sku) *
    from (
      select e.ord,
             nullif(btrim(e.obj ->> 'sku'), '') as sku,
             nullif(btrim(e.obj ->> 'name_th'), '') as name_th,
             nullif(btrim(e.obj ->> 'name_en'), '') as name_en,
             nullif(btrim(e.obj ->> 'category'), '') as category,
             nullif(btrim(e.obj ->> 'unit'), '') as unit,
             nullif(btrim(e.obj ->> 'supplier'), '') as supplier,
             (e.obj ->> 'unit_price')::numeric as unit_price,
             (e.obj ->> 'cost_price')::numeric as cost_price,
             (e.obj ->> 'stock_qty')::numeric as stock_qty,
             (e.obj ->> 'min_stock')::numeric as min_stock
      from jsonb_array_elements(p_rows) with ordinality as e(obj, ord)
    ) x
    where sku is not null
    order by sku, ord desc
  ),
  upd as (
    update public.products p
       set name_th     = coalesce(src.name_th, p.name_th),
           name_en     = coalesce(src.name_en, p.name_en),
           category    = coalesce(src.category, p.category),
           unit        = coalesce(src.unit, p.unit),
           supplier    = coalesce(src.supplier, p.supplier),
           unit_price  = coalesce(src.unit_price, p.unit_price),
           cost_price  = coalesce(src.cost_price, p.cost_price),
           stock_qty   = coalesce(src.stock_qty, p.stock_qty),
           min_stock   = coalesce(src.min_stock, p.min_stock),
           is_active   = true,
           source_file = coalesce(p_file_name, '')
      from src
     where p.sku = src.sku
    returning p.id
  ),
  ins as (
    insert into public.products
      (sku, name_th, name_en, category, unit, supplier, unit_price, cost_price, stock_qty, min_stock, source_file)
    select src.sku, coalesce(src.name_th, ''), coalesce(src.name_en, ''), coalesce(src.category, ''),
           coalesce(src.unit, ''), coalesce(src.supplier, ''), coalesce(src.unit_price, 0),
           coalesce(src.cost_price, 0), coalesce(src.stock_qty, 0), coalesce(src.min_stock, 0),
           coalesce(p_file_name, '')
      from src
     where not exists (select 1 from public.products p where p.sku = src.sku)
    returning id
  )
  select (select count(*) from ins), (select count(*) from upd) into v_created, v_updated;

  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;

create or replace function public.import_sales(p_rows jsonb, p_file_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_updated integer;
begin
  perform public.require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Rows must be an array of at most 2000 items' using errcode = '22023';
  end if;

  with src as (
    select distinct on (line_key) *
    from (
      select e.ord,
             btrim(e.obj ->> 'bill_no') || '|' || btrim(e.obj ->> 'sku') || '|' ||
               coalesce(nullif(e.obj ->> 'line_no', ''), '1') as line_key,
             btrim(e.obj ->> 'bill_no') as bill_no,
             (e.obj ->> 'sale_date')::date as sale_date,
             btrim(e.obj ->> 'sku') as sku,
             coalesce(btrim(e.obj ->> 'product_name'), '') as product_name,
             (e.obj ->> 'qty')::numeric as qty,
             coalesce(btrim(e.obj ->> 'unit'), '') as unit,
             coalesce((e.obj ->> 'unit_price')::numeric, 0) as unit_price,
             coalesce((e.obj ->> 'amount')::numeric, 0) as amount,
             coalesce(btrim(e.obj ->> 'customer_name'), '') as customer_name
      from jsonb_array_elements(p_rows) with ordinality as e(obj, ord)
    ) x
    order by line_key, ord desc
  ),
  up as (
    insert into public.sales
      (line_key, bill_no, sale_date, sku, product_name, qty, unit, unit_price, amount, customer_name, source_file)
    select line_key, bill_no, sale_date, sku, product_name, qty, unit, unit_price, amount, customer_name,
           coalesce(p_file_name, '')
      from src
    on conflict (line_key) do update
       set sale_date = excluded.sale_date,
           product_name = excluded.product_name,
           qty = excluded.qty,
           unit = excluded.unit,
           unit_price = excluded.unit_price,
           amount = excluded.amount,
           customer_name = excluded.customer_name,
           source_file = excluded.source_file
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_created, v_updated from up;

  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;

-- Invoices already corrected or exported in this app are NOT overwritten by a re-import
-- (Base44 overwrote them silently); they are reported as skipped_edited.
create or replace function public.import_invoices(p_rows jsonb, p_file_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_updated integer;
  v_skipped integer;
begin
  perform public.require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Rows must be an array of at most 500 items' using errcode = '22023';
  end if;

  with src as (
    select distinct on (doc_no) *
    from (
      select e.ord,
             btrim(e.obj ->> 'doc_no') as doc_no,
             (e.obj ->> 'doc_date')::date as doc_date,
             coalesce(btrim(e.obj ->> 'customer_name'), '') as customer_name,
             coalesce(btrim(e.obj ->> 'customer_tax_id'), '') as customer_tax_id,
             coalesce(btrim(e.obj ->> 'customer_address'), '') as customer_address,
             coalesce(btrim(e.obj ->> 'customer_branch'), '') as customer_branch,
             coalesce(e.obj -> 'items', '[]'::jsonb) as items,
             coalesce((e.obj ->> 'vat_rate')::numeric, 7) as vat_rate
      from jsonb_array_elements(p_rows) with ordinality as e(obj, ord)
    ) x
    where doc_no <> ''
    order by doc_no, ord desc
  ),
  upd as (
    update public.tax_invoices t
       set doc_date = src.doc_date,
           customer_name = src.customer_name,
           customer_tax_id = src.customer_tax_id,
           customer_address = src.customer_address,
           customer_branch = src.customer_branch,
           items = src.items,
           vat_rate = src.vat_rate,
           source_file = coalesce(p_file_name, '')
      from src
     where t.doc_no = src.doc_no and t.status = 'imported'
    returning t.id
  ),
  skipped as (
    select 1 from src join public.tax_invoices t on t.doc_no = src.doc_no where t.status <> 'imported'
  ),
  ins as (
    insert into public.tax_invoices
      (doc_no, doc_date, customer_name, customer_tax_id, customer_address, customer_branch, items, vat_rate, source_file)
    select doc_no, doc_date, customer_name, customer_tax_id, customer_address, customer_branch, items, vat_rate,
           coalesce(p_file_name, '')
      from src
     where not exists (select 1 from public.tax_invoices t where t.doc_no = src.doc_no)
    returning id
  )
  select (select count(*) from ins), (select count(*) from upd), (select count(*) from skipped)
    into v_created, v_updated, v_skipped;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped_edited', v_skipped);
end;
$$;

create or replace function public.record_import(
  p_kind text,
  p_file_name text,
  p_row_count integer,
  p_created integer,
  p_updated integer,
  p_skipped integer,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_id uuid;
begin
  perform public.require_admin();
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.sync_logs
    (kind, file_name, row_count, created_count, updated_count, skipped_count, imported_by, note)
  values
    (p_kind, coalesce(p_file_name, ''), coalesce(p_row_count, 0), coalesce(p_created, 0),
     coalesce(p_updated, 0), coalesce(p_skipped, 0), coalesce(v_email, ''), coalesce(p_note, ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Marks an invoice exported (stamps exported_at) — staff cannot call this.
create or replace function public.mark_invoice_exported(p_id uuid)
returns public.tax_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tax_invoices;
begin
  perform public.require_admin();
  update public.tax_invoices
     set status = 'exported', exported_at = now()
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- Saves invoice edits; status moves imported -> edited (exported stays exported).
create or replace function public.save_invoice(
  p_id uuid,
  p_customer_name text,
  p_customer_tax_id text,
  p_customer_address text,
  p_customer_branch text,
  p_doc_date date,
  p_items jsonb,
  p_discount numeric,
  p_vat_rate numeric,
  p_note text
)
returns public.tax_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tax_invoices;
  v_email text;
begin
  perform public.require_admin();
  select email into v_email from public.profiles where id = auth.uid();
  update public.tax_invoices
     set customer_name = coalesce(p_customer_name, ''),
         customer_tax_id = coalesce(p_customer_tax_id, ''),
         customer_address = coalesce(p_customer_address, ''),
         customer_branch = coalesce(p_customer_branch, ''),
         doc_date = p_doc_date,
         items = p_items,
         discount = coalesce(p_discount, 0),
         vat_rate = coalesce(p_vat_rate, 0),
         note = coalesce(p_note, ''),
         edited_by = coalesce(v_email, ''),
         edited_at = now(),
         status = case when status = 'exported' then 'exported' else 'edited' end
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- Upsert monthly target by (year, month).
create or replace function public.set_monthly_target(p_year integer, p_month integer, p_amount numeric)
returns public.monthly_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.monthly_targets;
begin
  perform public.require_admin();
  insert into public.monthly_targets (year, month, target_amount)
  values (p_year, p_month, p_amount)
  on conflict (year, month) do update set target_amount = excluded.target_amount
  returning * into v_row;
  return v_row;
end;
$$;
