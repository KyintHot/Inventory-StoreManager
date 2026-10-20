import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { createFakeDb, installFakeSupabase, signIn } from './fakeSupabase'

const VIEWPORTS = [
  { name: '360', width: 360, height: 740 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
]

const PAGES: { path: string; ready: string }[] = [
  { path: '/', ready: 'Sales overview' },
  { path: '/inventory', ready: 'Inventory & restock' },
  { path: '/sales', ready: 'Sales history' },
  { path: '/invoices', ready: 'Tax invoices' },
  { path: '/invoices/i-1', ready: 'IV6910-001' },
  { path: '/import', ready: 'Import from Comet5' },
  { path: '/team', ready: 'Team & access' },
  { path: '/settings', ready: 'Settings' },
]

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/screens'

async function overflow(page: Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement!
    const offenders: string[] = []
    document.querySelectorAll<HTMLElement>('body *').forEach((n) => {
      const r = n.getBoundingClientRect()
      if (r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(n).position !== 'fixed') {
        // elements inside an intentionally scrollable container are fine
        let p: HTMLElement | null = n.parentElement
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflowX
          if (o === 'auto' || o === 'scroll' || o === 'hidden') return
          p = p.parentElement
        }
        offenders.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)}`)
      }
    })
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth, offenders: offenders.slice(0, 5) }
  })
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    // eight pages, full-page screenshots: comfortably fast on its own, but the viewports run
    // in parallel against one Vite dev server, so give the loop room instead of flaking on time
    test.slow()

    test('no page overflows horizontally, and every page renders', async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true })
      const db = createFakeDb('admin')
      await installFakeSupabase(page, db)
      await signIn(page, db.email)
      await expect(page.getByRole('heading', { name: 'Sales overview' })).toBeVisible()
      for (const p of PAGES) {
        await page.goto(p.path)
        await expect(page.getByRole('heading', { name: p.ready, exact: true })).toBeVisible()
        await page.waitForLoadState('networkidle')
        const o = await overflow(page)
        expect(o.scrollWidth, `${p.path} @${vp.name}: horizontal scroll (offenders: ${o.offenders.join(', ')})`).toBeLessThanOrEqual(o.innerWidth)
        await page.screenshot({ path: `${SHOTS}/${vp.name}-${p.path.replace(/\W+/g, '_') || 'home'}.png`, fullPage: true })
      }
    })
  })
}

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('drawer opens, navigates, closes, and is operable', async ({ page }) => {
    const db = createFakeDb('admin')
    await installFakeSupabase(page, db)
    await signIn(page, db.email)
    await expect(page.getByRole('heading', { name: 'Sales overview' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden() // desktop sidebar hidden on phones
    await page.getByRole('button', { name: 'Open menu' }).click()
    const nav = page.getByRole('dialog').getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Inventory' })).toBeVisible()
    await nav.getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL(/\/inventory$/)
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('touch targets in primary controls are at least 40px', async ({ page }) => {
    const db = createFakeDb('admin')
    await installFakeSupabase(page, db)
    await signIn(page, db.email)
    await page.goto('/inventory')
    await expect(page.getByText('Inventory & restock')).toBeVisible()
    for (const loc of [page.getByRole('button', { name: 'Open menu' }), page.getByRole('searchbox', { name: 'Search' }), page.getByRole('combobox', { name: 'Stock level' })]) {
      const box = await loc.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(40)
    }
  })
})
