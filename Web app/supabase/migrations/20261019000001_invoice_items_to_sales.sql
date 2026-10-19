-- Invoice imports must feed the money charts as well: revenue, target progress, the trend
-- chart and top sellers all read public.sales, so every invoice's line items are mirrored
-- into sales when invoices are imported or corrected. Until now importing a Comet5 invoice
-- file left all of those charts at zero even though the invoices themselves imported fine.
--
-- line_key reuses import_sales' bill|sku|line_no scheme, so importing the matching sales CSV
-- later updates these rows instead of duplicating them, and re-importing the invoice file
-- stays idempotent too. Because line_keys are namespaced by bill, a synced invoice owns its
-- bill's sales rows: lines that disappear from the invoice are deleted from sales.

-- Internal helper: rebuild sales lines from the CURRENT items of the given invoices
-- (p_docs = null = every invoice, without deletions — used by the one-time backfill).
-- Called by import_invoices after its upsert and by save_invoice after an edit, so corrected
-- invoices mirror their corrected items immediately.
create or replace function public.sync_invoice_sales(p_docs text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upserted integer;
begin
  with lines as (
    select t.doc_no,
           btrim(coalesce(i.obj ->> 'sku', '')) as sku,
           row_number() over (partition by t.doc_no, btrim(coalesce(i.obj ->> 'sku', '')) order by i.ord) as line_no,
           t.doc_date,
           coalesce(nullif(btrim(coalesce(i.obj ->> 'description', '')), ''),
                    btrim(coalesce(i.obj ->> 'sku', '')))              as product_name,
           coalesce((i.obj ->> 'qty')::numeric, 0)                     as qty,
           btrim(coalesce(i.obj ->> 'unit', ''))                       as unit,
           coalesce((i.obj ->> 'unit_price')::numeric, 0)              as unit_price,
           coalesce((i.obj ->> 'amount')::numeric, 0)                  as amount,
           t.customer_name,
           t.source_file
      from public.tax_invoices t
      cross join lateral jsonb_array_elements(t.items) with ordinality as i(obj, ord)
     where (p_docs is null or t.doc_no = any (p_docs))
       and btrim(coalesce(i.obj ->> 'sku', '')) <> ''
       and coalesce((i.obj ->> 'qty')::numeric, 0) <> 0
  ),
  ins as (
    insert into public.sales
      (line_key, bill_no, sale_date, sku, product_name, qty, unit, unit_price, amount, customer_name, source_file)
    select doc_no || '|' || sku || '|' || line_no, doc_no, doc_date, sku, product_name,
           qty, unit, unit_price, amount, customer_name, source_file
      from lines
    on conflict (line_key) do update
       set sale_date     = excluded.sale_date,
           product_name  = excluded.product_name,
           qty           = excluded.qty,
           unit          = excluded.unit,
           unit_price    = excluded.unit_price,
           amount        = excluded.amount,
           customer_name = excluded.customer_name,
           source_file   = excluded.source_file
    returning 1
  ),
  del as (
    delete from public.sales s
     where p_docs is not null
       and s.bill_no = any (p_docs)
       and s.line_key <> all (select doc_no || '|' || sku || '|' || line_no from lines)
  )
  select count(*) into v_upserted from ins;
  return v_upserted;
end;
$$;

-- Internal: only the import/save RPCs (running as their definer) and migrations call this.
revoke execute on function public.sync_invoice_sales(text[]) from public, anon, authenticated, service_role;

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
  v_sales   integer;
  v_docs    text[];
begin
  perform public.require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Rows must be an array of at most 500 items' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct btrim(coalesce(e.obj ->> 'doc_no', ''))), array[]::text[])
    into v_docs
    from jsonb_array_elements(p_rows) as e(obj)
   where btrim(coalesce(e.obj ->> 'doc_no', '')) <> '';

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

  -- Runs after the upsert, so it mirrors each invoice's FINAL items — including invoices a
  -- previous import corrected in this app (their items are never replaced by the file).
  v_sales := public.sync_invoice_sales(v_docs);

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped_edited', v_skipped,
    'sales_lines', v_sales
  );
end;
$$;

-- Saves invoice edits; status moves imported -> edited (exported stays exported).
-- Sales lines are re-mirrored from the corrected items so the money charts follow the edit.
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
  perform public.sync_invoice_sales(array[v_row.doc_no]);
  return v_row;
end;
$$;

-- One-time backfill: invoices imported before this migration never produced sales rows.
-- Upsert-only — it never deletes, so sales rows that arrived as a sales CSV stay untouched.
select public.sync_invoice_sales(null);
