-- The invite endpoint (api/invite-user.ts) writes profiles.role with the service-role key
-- immediately after GoTrue creates the invited user. rls_grants.sql only ever granted
-- UPDATE (role) to `authenticated`, so the service key hit:
--
--   [invite-user] role update failed: permission denied for table profiles
--
-- Every admin invitation therefore returned 502 *after* the invite email had already been
-- sent, and the requested access level was silently never applied (observed live 2026-10-17).
--
-- Least privilege: the handler writes one column, and supabase-js reads the row back
-- (`Prefer: return=representation` / .select('id')), so both UPDATE (role) and SELECT are
-- required — granting only UPDATE still failed with the same "permission denied" message.
-- RLS stays enabled; service_role bypasses it by platform design, same as it already does for
-- auth.users.
grant update (role) on public.profiles to service_role;
grant select on public.profiles to service_role;
