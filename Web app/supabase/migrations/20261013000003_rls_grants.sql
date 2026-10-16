-- Row Level Security + grants. Deny by default: RLS on every table, anon gets nothing,
-- authenticated gets read access and (admin-only) writes strictly through policies/RPCs.

-- auth.users -> profiles
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles              enable row level security;
alter table public.products              enable row level security;
alter table public.product_stock_history enable row level security;
alter table public.sales                 enable row level security;
alter table public.tax_invoices          enable row level security;
alter table public.company_profile       enable row level security;
alter table public.monthly_targets       enable row level security;
alter table public.sync_logs             enable row level security;
alter table public.audit_logs            enable row level security;

-- Start from nothing, then grant the minimum.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles, public.products, public.product_stock_history, public.sales,
                public.tax_invoices, public.company_profile, public.monthly_targets,
                public.sync_logs, public.audit_logs
  to authenticated;

-- Direct writes (everything else goes through SECURITY DEFINER RPCs):
grant update (full_name) on public.profiles to authenticated;          -- self-service name
grant update (role)      on public.profiles to authenticated;          -- admin only via policy + trigger
grant update (name_th, name_en, category, unit, unit_price, stock_qty, min_stock)
  on public.products to authenticated;                                  -- admin only via policy
grant insert, update on public.company_profile to authenticated;       -- admin only via policy
grant delete on public.monthly_targets to authenticated;               -- admin only via policy

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- read-only business data for every signed-in team member ---------------------
create policy products_select on public.products
  for select to authenticated using (public.is_member());
create policy products_update_admin on public.products
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy stock_history_select on public.product_stock_history
  for select to authenticated using (public.is_member());

create policy sales_select on public.sales
  for select to authenticated using (public.is_member());

create policy tax_invoices_select on public.tax_invoices
  for select to authenticated using (public.is_member());

create policy company_profile_select on public.company_profile
  for select to authenticated using (public.is_member());
create policy company_profile_insert_admin on public.company_profile
  for insert to authenticated with check (public.is_admin() and id = 1);
create policy company_profile_update_admin on public.company_profile
  for update to authenticated using (public.is_admin()) with check (public.is_admin() and id = 1);

create policy monthly_targets_select on public.monthly_targets
  for select to authenticated using (public.is_member());
create policy monthly_targets_delete_admin on public.monthly_targets
  for delete to authenticated using (public.is_admin());

create policy sync_logs_select on public.sync_logs
  for select to authenticated using (public.is_member());

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated using (public.is_admin());

-- Function privileges: nothing is executable by PUBLIC/anon; list what clients may call.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.is_member(),
  public.like_pattern(text),
  public.products_filtered(text, text, text),
  public.product_categories(),
  public.inventory_alert_counts(),
  public.sales_filtered(date, date, text),
  public.sales_summary(date, date, text),
  public.sales_by_customer(date, date, integer),
  public.dashboard_summary(integer, integer),
  public.import_products(jsonb, text),
  public.import_sales(jsonb, text),
  public.import_invoices(jsonb, text),
  public.record_import(text, text, integer, integer, integer, integer, text),
  public.mark_invoice_exported(uuid),
  public.save_invoice(uuid, text, text, text, text, date, jsonb, numeric, numeric, text),
  public.set_monthly_target(integer, integer, numeric)
to authenticated;
