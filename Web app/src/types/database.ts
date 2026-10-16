// Hand-maintained row types mirroring supabase/migrations. Regenerate with
// `npx supabase gen types typescript --project-id <ref>` once a project exists and
// reconcile with these shapes. Numeric columns arrive from PostgREST as numbers.

export type Role = 'admin' | 'user'
export type StockState = 'ok' | 'low' | 'critical'
export type InvoiceStatus = 'imported' | 'edited' | 'exported'
export type ImportKind = 'products' | 'sales' | 'invoices'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  created_at: string
}

export interface Product {
  id: string
  sku: string
  name_th: string
  name_en: string
  category: string
  unit: string
  unit_price: number
  cost_price: number
  stock_qty: number
  min_stock: number
  restock_qty: number
  stock_state: StockState
  supplier: string
  is_active: boolean
}

export interface SaleLine {
  id: string
  bill_no: string
  sale_date: string
  sku: string
  product_name: string
  qty: number
  unit: string
  unit_price: number
  amount: number
  customer_name: string
}

export interface InvoiceItem {
  sku: string
  description: string
  qty: number
  unit: string
  unit_price: number
  amount: number
}

export interface TaxInvoice {
  id: string
  doc_no: string
  doc_date: string
  customer_name: string
  customer_tax_id: string
  customer_address: string
  customer_branch: string
  items: InvoiceItem[]
  subtotal: number
  discount: number
  vat_rate: number
  vat_amount: number
  total: number
  note: string
  status: InvoiceStatus
  edited_by: string
  edited_at: string | null
  exported_at: string | null
}

export interface CompanyProfile {
  id: 1
  name_th: string
  name_en: string
  tax_id: string
  branch: string
  address: string
  phone: string
  email: string
  vat_rate: number
  invoice_note: string
  logo_url: string
}

export interface MonthlyTarget {
  id: string
  year: number
  month: number
  target_amount: number
}

export interface SyncLog {
  id: string
  kind: ImportKind
  file_name: string
  row_count: number
  created_count: number
  updated_count: number
  skipped_count: number
  imported_by: string
  note: string
  created_at: string
}

export interface DashboardSummary {
  revenue: number
  units: number
  bills: number
  trend: { month: string; revenue: number }[]
  topSkus: { sku: string; name_th: string; name_en: string; qty: number; revenue: number }[]
  alerts: Pick<Product, 'id' | 'sku' | 'name_th' | 'name_en' | 'unit' | 'stock_qty' | 'min_stock' | 'restock_qty' | 'stock_state'>[]
  alertCount: number
  target: { year: number; month: number; target_amount: number } | null
  lastLog: { kind: ImportKind; file_name: string; row_count: number; created_at: string } | null
}

export interface SalesSummary {
  revenue: number
  units: number
  bills: number
  lines: number
}

export interface CustomerSales {
  customer_name: string
  bills: number
  units: number
  revenue: number
}
