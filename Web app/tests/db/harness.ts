import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Runs the real migrations in an in-process Postgres (PGlite) with a minimal stand-in for
 * Supabase's `auth` schema and roles. This verifies SQL, triggers, RLS policies and
 * function grants without a Supabase project. It does NOT test Supabase Auth/GoTrue itself.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
-- Supabase's platform role for the service-role key (api/invite-user.ts writes profiles.role
-- with it, so 20261017000000_grant_profiles_role_to_service_role.sql grants to it).
create role service_role nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
`

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return db
}

export async function addUser(db: PGlite, email: string, fullName = ''): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName],
  )
  return res.rows[0]!.id
}

/** Run `fn` as a signed-in Supabase user (role `authenticated`, auth.uid() = userId). */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}

/** Resolve with the error message if `fn` throws, else fail the test. */
export async function expectDbError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  throw new Error('Expected a database error but the call succeeded')
}
