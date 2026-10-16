import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fallbackMessages, messages, type Lang, type MessageKey } from './messages'

const STORAGE_KEY = 'ole.lang'

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: MessageKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'th' ? 'th' : 'en'
  } catch {
    return 'en' // storage can be blocked (private mode)
  }
}

/** Translate outside React (e.g. global query error handlers) using the stored language. */
export function translateStatic(key: MessageKey): string {
  const lang = readStoredLang()
  return messages[lang][key] ?? fallbackMessages[key] ?? key
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* preference just will not persist */
    }
  }, [])

  const t = useCallback((key: MessageKey) => messages[lang][key] ?? fallbackMessages[key] ?? key, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside LanguageProvider')
  return ctx
}
