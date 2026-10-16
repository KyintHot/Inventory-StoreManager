import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

/** A visible caption above a control that has no <label> of its own (e.g. a Radix Select). */
export function FilterLabel({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{text}</span>
      {children}
    </div>
  )
}

/** Search input that applies on submit, blur, or after a short pause (not on every keystroke). */
export function SearchBox({
  value,
  onCommit,
  placeholder,
  label,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder: string
  label: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value) return
    const id = setTimeout(() => onCommit(draft), 400)
    return () => clearTimeout(id)
  }, [draft, value, onCommit])

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        onCommit(draft)
      }}
    >
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        placeholder={placeholder}
        className="pl-9"
      />
    </form>
  )
}
