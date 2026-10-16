import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney } from '@/utils/format'

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export interface TrendPoint {
  label: string
  revenue: number
}

/** Kept in its own module so Recharts is only downloaded once the dashboard is opened. */
export default function TrendChart({ data, seriesLabel }: { data: TrendPoint[]; seriesLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={44}
          tickFormatter={(v: number) => COMPACT.format(v)}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          formatter={(v) => [formatMoney(v), seriesLabel]}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}
        />
        <Bar dataKey="revenue" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  )
}
