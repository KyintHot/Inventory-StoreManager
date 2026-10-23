import { expect, test, type Page } from '@playwright/test'
import { createFakeDb, installFakeSupabase, signIn, type FakeDb } from './fakeSupabase'

async function boot(page: Page, role: 'admin' | 'user' = 'admin'): Promise<FakeDb> {
  const db = createFakeDb(role)
  await installFakeSupabase(page, db)
  await signIn(page, db.email)
  await expect(page.getByRole('heading', { name: 'Sales overview' })).toBeVisible()
  return db
}

test.describe('authentication', () => {
  test('redirects signed-out visitors to the login page', async ({ page }) => {
    await installFakeSupabase(page, createFakeDb())
    await page.goto('/inventory')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('shows a vague error for a wrong password and stays on login', async ({ page }) => {
    await installFakeSupabase(page, createFakeDb())
    await signIn(page, 'owner@ole.test', 'wrong-password')
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('validates the form before calling the server', async ({ page }) => {
    const db = createFakeDb()
    await installFakeSupabase(page, db)
    await page.goto('/login')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    expect(db.calls.filter((c) => c.path.includes('/auth/v1/token'))).toHaveLength(0)
  })

  test('has no public sign-up link (invite-only)', async ({ page }) => {
    await installFakeSupabase(page, createFakeDb())
    await page.goto('/login')
    await expect(page.getByText(/create one/i)).toHaveCount(0)
    await page.goto('/register')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('forgot password gives the same confirmation either way', async ({ page }) => {
    await installFakeSupabase(page, createFakeDb())
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('anyone@example.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toContainText('reset link is on its way')
  })

  test('signs out and protects routes again', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Sign out' }).first().click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/sales')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('roles', () => {
  test('admin sees every menu item', async ({ page }) => {
    await boot(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const name of ['Overview', 'Inventory', 'Sales', 'Tax invoices', 'Import from Comet5', 'Team', 'Settings']) {
      await expect(nav.getByRole('link', { name })).toBeVisible()
    }
  })

  test('staff cannot see or open admin pages, and has no edit controls', async ({ page }) => {
    await boot(page, 'user')
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const name of ['Import from Comet5', 'Team', 'Settings']) await expect(nav.getByRole('link', { name })).toHaveCount(0)
    await page.goto('/settings')
    await expect(page.getByText('Only owners and admins can manage users')).toBeVisible()
    await page.goto('/inventory')
    await expect(page.getByRole('button', { name: /Edit product/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export restock list' })).toHaveCount(0)
    await page.goto('/invoices/i-1')
    await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export corrected file' })).toHaveCount(0)
  })
})

test.describe('dashboard', () => {
  test('shows real numbers, the target progress and links alerts to the filtered inventory', async ({ page }) => {
    await boot(page)
    await expect(page.getByText('฿1,948.00').first()).toBeVisible() // 1210 + 738
    await expect(page.getByRole('progressbar', { name: 'Monthly target' })).toHaveAttribute('aria-valuenow', '39')
    await page.getByRole('link', { name: /Items to reorder/ }).click()
    await expect(page).toHaveURL(/\/inventory\?alerts=1/)
    await expect(page.getByRole('cell', { name: 'HNY-001', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'SYR-001', exact: true })).toHaveCount(0)
  })

  test('survives an API failure with a retry', async ({ page }) => {
    const db = createFakeDb()
    await installFakeSupabase(page, db)
    await signIn(page, db.email)
    await page.waitForURL('/')
    await expect(page.getByRole('heading', { name: 'Sales overview' })).toBeVisible()
    db.fail = { path: 'dashboard_summary', times: 3 } // initial try + 2 automatic retries
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('Something went wrong', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Sales overview' })).toBeVisible()
  })
})

test.describe('inventory', () => {
  test('filters by search and stock level', async ({ page }) => {
    await boot(page)
    await page.goto('/inventory')
    await expect(page.getByRole('cell', { name: 'SYR-002', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search' }).fill('longan')
    await expect(page.getByRole('cell', { name: 'HNY-002', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'HNY-001', exact: true })).toHaveCount(0)
    await page.getByRole('searchbox', { name: 'Search' }).fill('')
    await page.getByRole('combobox', { name: 'Stock level' }).click()
    await page.getByRole('option', { name: /^Critical/ }).click()
    await expect(page.getByRole('cell', { name: 'HNY-001', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'HNY-002', exact: true })).toHaveCount(0)
  })

  test('admin edits stock and the alert clears after the backend confirms', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/inventory')
    await page.getByRole('button', { name: 'Edit product HNY-001' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('SKU')).toBeDisabled()
    await dialog.getByLabel('Current stock').fill('100')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Product saved')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(db.products.find((p) => p.sku === 'HNY-001')!.stock_qty).toBe(100)
    await expect(page.getByRole('row', { name: /HNY-001/ }).getByText('Sufficient')).toBeVisible()
  })

  test('rejects a negative reorder point without calling the server', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/inventory')
    await page.getByRole('button', { name: 'Edit product HNY-001' }).click()
    await page.getByRole('dialog').getByLabel('Reorder point (min stock)').fill('-5')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(db.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  test('shows a permission error when the backend refuses the update', async ({ page }) => {
    const db = await boot(page, 'admin')
    db.role = 'user' // simulate RLS filtering the row after the UI loaded as admin
    await page.goto('/inventory')
    await page.getByRole('button', { name: 'Edit product HNY-002' }).click()
    await page.getByRole('dialog').getByLabel('Current stock').fill('7')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('You do not have permission to do this.')).toBeVisible()
  })
})

test.describe('sales', () => {
  test('summarises, filters and groups by customer', async ({ page }) => {
    await boot(page)
    await page.goto('/sales')
    await expect(page.getByText('฿1,948.00').first()).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search' }).fill('acme')
    await expect(page.getByRole('cell', { name: 'IV6910-002' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'IV6910-001' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'By customer' }).click()
    await expect(page.getByRole('cell', { name: 'ร้านสุขใจ' })).toBeVisible()
  })
})

test.describe('tax invoices', () => {
  test('lists, filters by status and opens an invoice', async ({ page }) => {
    await boot(page)
    await page.goto('/invoices')
    await expect(page.getByRole('cell', { name: 'IV6910-001' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Status' }).click()
    await page.getByRole('option', { name: 'Exported' }).click()
    await expect(page.getByRole('cell', { name: 'IV6910-002' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'IV6910-001' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Open' }).click()
    await expect(page).toHaveURL(/\/invoices\/i-2$/)
  })

  test('recalculates the total live, saves via the backend and marks it edited', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/invoices/i-1')
    await expect(page.getByTestId('invoice-total')).toHaveText('฿1,294.70')
    await page.getByTestId('item-qty-0').fill('20') // 20 x 121 = 2,420 -> +7% VAT = 2,589.40
    await expect(page.getByTestId('invoice-total')).toHaveText('฿2,589.40')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Invoice saved')).toBeVisible()
    const saved = db.invoices.find((i) => i.id === 'i-1')!
    expect(saved.status).toBe('edited')
    expect(saved.total).toBe(2589.4)
    await expect(page.getByText('Edited', { exact: true })).toBeVisible()
  })

  test('exports a corrected file and marks the invoice exported', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/invoices/i-1')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export corrected file' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('IV6910-001.xlsx')
    const path = await file.path()
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(path).subarray(0, 2).toString()).toBe('PK') // a real .xlsx is a zip container
    await expect(page.getByText('Downloaded')).toBeVisible()
    expect(db.invoices.find((i) => i.id === 'i-1')!.status).toBe('exported')
  })
})

test.describe('import', () => {
  test('maps columns automatically, previews, imports and logs a products file', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/import')
    const csv = 'รหัสสินค้า,ชื่อสินค้า,หน่วย,ราคาขาย,คงเหลือ,จุดสั่งซื้อ\nNEW-001,น้ำผึ้งทดลอง,ขวด,"1,250.50",12,30\n,ไม่มีรหัส,ขวด,10,1,1\n'
    await page.getByTestId('import-file-input').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
    await expect(page.getByText('products.csv')).toBeVisible()
    await expect(page.getByText('Row 3 — SKU is missing')).toBeVisible()
    await expect(page.getByText('1 rows ready').first()).toBeVisible()
    await page.getByRole('button', { name: 'Import now' }).click()
    await expect(page.getByRole('status').getByText('Import finished')).toBeVisible()
    const rpc = db.calls.find((c) => c.path.includes('import_products'))!
    expect(rpc.body.p_rows).toHaveLength(1)
    expect(rpc.body.p_rows[0]).toMatchObject({ sku: 'NEW-001', unit_price: 1250.5, stock_qty: 12, min_stock: 30, cost_price: null })
    expect(db.calls.some((c) => c.path.includes('record_import'))).toBe(true)
  })

  test('a sales export dropped on "products" switches the type instead of overwriting stock', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/import')
    await expect(page.getByRole('radio', { name: 'Products' })).toHaveAttribute('aria-checked', 'true')
    const csv = 'เลขที่บิล,วันที่,รหัสสินค้า,ชื่อสินค้า,จำนวน,หน่วย,ราคาต่อหน่วย,มูลค่า,ลูกค้า\nIV6910-200,2026-10-06,HNY-001,น้ำผึ้งดอกลำไย,2,ขวด,121,242,ร้านสุขใจ\n'
    await page.getByTestId('import-file-input').setInputFiles({ name: 'sales-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
    await expect(page.getByText('switched to Sales')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Sales' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('SKU is missing')).toHaveCount(0)
    await expect(page.getByText('1 rows ready').first()).toBeVisible()
    await page.getByRole('button', { name: 'Import now' }).click()
    await expect(page.getByRole('status').getByText('Import finished')).toBeVisible()
    // the old failure mode: the file went to import_products and wrote sold qty into stock
    expect(db.calls.some((c) => c.path.includes('import_products'))).toBe(false)
    const rpc = db.calls.find((c) => c.path.includes('import_sales'))!
    expect(rpc.body.p_rows[0]).toMatchObject({ bill_no: 'IV6910-200', sale_date: '2026-10-06', sku: 'HNY-001', qty: 2, amount: 242, line_no: 1 })
  })

  test('reads a real .xlsx workbook (Thai headers, Excel date cell) for a sales import', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/import')
    await page.getByRole('radio', { name: 'Sales' }).click()
    const { default: writeXlsx } = await import('write-excel-file/node')
    const buffer = await writeXlsx(
      [
        ['เลขที่บิล', 'วันที่', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'มูลค่า', 'ลูกค้า'],
        ['IV6910-100', new Date(Date.UTC(2026, 9, 5)), 'HNY-001', 'น้ำผึ้ง', 3, 121, 363, 'ร้านสุขใจ'],
        ['IV6910-100', new Date(Date.UTC(2026, 9, 5)), 'HNY-001', 'น้ำผึ้ง', 1, 121, 121, 'ร้านสุขใจ'],
      ],
      { sheet: 'Sheet1', dateFormat: 'yyyy-mm-dd' },
    ).toBuffer()
    await page.getByTestId('import-file-input').setInputFiles({
      name: 'sales.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })
    await expect(page.getByText('2 rows ready').first()).toBeVisible()
    await page.getByRole('button', { name: 'Import now' }).click()
    await expect(page.getByRole('status').getByText('Import finished')).toBeVisible()
    const rpc = db.calls.find((c) => c.path.includes('import_sales'))!
    expect(rpc.body.p_rows[0]).toMatchObject({ bill_no: 'IV6910-100', sale_date: '2026-10-05', sku: 'HNY-001', qty: 3, amount: 363, customer_name: 'ร้านสุขใจ', line_no: 1 })
    expect(rpc.body.p_rows[1]).toMatchObject({ qty: 1, line_no: 2 }) // same bill+SKU twice -> distinct line numbers
  })

  test('reads a printed Comet5 .xls invoice, switches the type and imports it', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/import')
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    // the page starts on "products", which used to turn this printed page into 16 junk rows
    await expect(page.getByRole('radio', { name: 'Products' })).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('import-file-input').setInputFiles({
      name: '6666.xls',
      mimeType: 'application/vnd.ms-excel',
      buffer: readFileSync(resolve('tests/fixtures/comet5/6666.xls')),
    })
    await expect(page.getByText('the import type was switched to Tax invoices')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Tax invoices' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('Cleaned automatically — Comet5 document format')).toBeVisible()
    await expect(page.getByText(/— SKU is missing/)).toHaveCount(0) // the old failure mode
    await expect(page.getByText('1 rows ready').first()).toBeVisible()
    await page.getByRole('button', { name: 'Import now' }).click()
    await expect(page.getByRole('status').getByText('Import finished')).toBeVisible()
    const rpc = db.calls.find((c) => c.path.includes('import_invoices'))!
    expect(rpc.body.p_file_name).toBe('6666.xls')
    expect(rpc.body.p_rows).toHaveLength(1)
    expect(rpc.body.p_rows[0]).toMatchObject({ doc_no: 'INV-900001', doc_date: '2026-10-19' })
    expect(rpc.body.p_rows[0].items).toHaveLength(1)
    expect(rpc.body.p_rows[0].items[0]).toMatchObject({ sku: '000001', qty: 1, unit_price: 550, amount: 550 })
    expect(db.calls.some((c) => c.path.includes('record_import'))).toBe(true)
  })

  test('rejects unsupported and unreadable files with a clear message', async ({ page }) => {
    await boot(page)
    await page.goto('/import')
    // a legacy .xls is supported now, and SheetJS reads even junk as a one-cell sheet,
    // so the guard that fires is the empty one
    await page.getByTestId('import-file-input').setInputFiles({ name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') })
    await expect(page.getByRole('alert').filter({ hasText: 'No rows found' })).toBeVisible()
    // a corrupt .xlsx cannot be parsed at all
    await page.getByTestId('import-file-input').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') })
    await expect(page.getByRole('alert').filter({ hasText: 'could not be read' })).toBeVisible()
    // …while a format we have no reader for is still "not supported"
    await page.getByTestId('import-file-input').setInputFiles({ name: 'table.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer: Buffer.from('x') })
    await expect(page.getByRole('alert').filter({ hasText: '.csv, .xlsx or the legacy .xls' })).toBeVisible()
    await page.getByTestId('import-file-input').setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n') })
    await expect(page.getByRole('alert').filter({ hasText: 'No rows found' })).toBeVisible()
  })
})

test.describe('settings and team', () => {
  test('saves the monthly target and shows it in the list', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/settings')
    await page.getByLabel('Target (THB)').fill('80000')
    await page.getByRole('button', { name: 'Save target' }).click()
    await expect(page.getByText('Target saved')).toBeVisible()
    expect(db.targets.some((t) => t.target_amount === 80000)).toBe(true)
  })

  test('validates company email and saves details', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/settings')
    await page.getByLabel('Email', { exact: true }).fill('not-an-email')
    await page.getByRole('button', { name: 'Save company details' }).click()
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill('billing@ole.test')
    await page.getByRole('button', { name: 'Save company details' }).click()
    await expect(page.getByText('Company details saved')).toBeVisible()
    expect(db.company.email).toBe('billing@ole.test')
  })

  test('lists members and lets the admin change a role', async ({ page }) => {
    const db = await boot(page)
    await page.goto('/team')
    await expect(page.getByText('staff@ole.test')).toBeVisible()
    await page.getByRole('combobox', { name: /Access level: staff@ole.test/ }).click()
    await page.getByRole('option', { name: 'Owner / admin' }).click()
    await expect(page.getByText('Access updated')).toBeVisible()
    expect(db.profiles.find((p) => p.id === 'u-staff')!.role).toBe('admin')
  })
})

test.describe('language', () => {
  test('switches to Thai and remembers the choice', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'TH' }).first().click()
    await expect(page.getByRole('heading', { name: 'ภาพรวมยอดขาย' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'ภาพรวมยอดขาย' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'th')
  })
})

