-- Same failure class as 20261017000000, one level down: rls_grants.sql revokes the default
-- PUBLIC execute grant and re-grants only to `authenticated`, so the service-role key could
-- call NO function at all. Observed live on 2026-10-20 as
--
--   {"code":"42501","message":"permission denied for function import_products"}
--
-- for every RPC. The browser app worked (it runs as `authenticated`), but every server-side
-- caller of these functions — scripts, cron jobs, this repo's `npm run smoke:live` check —
-- failed at the privilege layer before any business rule ran.
--
-- Grant the trusted platform role the same explicit list granted to `authenticated` in
-- 20261013000003. Authorization is unchanged: RPCs that call require_admin() still refuse a
-- service-role caller that presents no admin JWT claim.
--
-- sync_invoice_sales stays internal (20261019000001 already revoked it from everyone): it
-- mutates sales for a whole bill and is only ever reached through the definer-owned
-- import_invoices / save_invoice functions.

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
to service_role;
