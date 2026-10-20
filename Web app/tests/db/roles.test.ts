// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asAnon, asService, asUser, createTestDb, expectDbError } from './harness'

let db: PGlite
let admin: string

beforeAll(async () => {
  db = await createTestDb()
  admin = await addUser(db, 'owner@ole.test', 'Owner')
})
afterAll(async () => {
  await db.close()
})

describe('service-role function privileges (migration 20261020000001)', () => {
  it('lets the service role execute the client RPCs when it presents an admin claim', async () => {
    const r = await asService(db, admin, () =>
      db.query<{ r: { created: number } }>(`select public.import_products($1::jsonb, '') as r`, [JSON.stringify([])]),
    )
    expect((r.rows[0] as { r: { created: number } }).r.created).toBe(0)
  })

  it('still refuses the import without an admin claim (authorization is separate from the grant)', async () => {
    const msg = await expectDbError(() =>
      asService(db, null, () => db.query(`select public.import_products($1::jsonb, '')`, [JSON.stringify([])])),
    )
    expect(msg).toMatch(/Only owners and admins/)
    expect(msg).not.toMatch(/permission denied/)
  })

  it('keeps sync_invoice_sales internal: denied to the service role and to signed-in admins', async () => {
    const m1 = await expectDbError(() => asService(db, admin, () => db.query(`select public.sync_invoice_sales(null)`)))
    expect(m1).toMatch(/permission denied/)
    const m2 = await expectDbError(() => asUser(db, admin, () => db.query(`select public.sync_invoice_sales(null)`)))
    expect(m2).toMatch(/permission denied/)
  })

  it('still grants anon nothing', async () => {
    const msg = await expectDbError(() => asAnon(db, () => db.query(`select public.import_products('[]'::jsonb, '')`)))
    expect(msg).toMatch(/permission denied/)
  })
})
