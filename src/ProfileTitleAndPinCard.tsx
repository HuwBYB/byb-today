// --- Migration (run once in Supabase SQL editor) ---------------------------
// alter table profiles add column if not exists theme text check (theme in ('pastel','mono-light','mono-dark','deep')) default 'pastel';
// alter table profiles add column if not exists accent text check (accent in ('lavender','mint','sky','peach','lemon')) default 'lavender';
// alter table profiles add column if not exists deepaccent text check (deepaccent in ('indigo','emerald','rose','cobalt','purple')) default 'indigo';

import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient'

// Keep keys aligned with the CSS system
export type ThemeFamily = 'pastel' | 'mono-light' | 'mono-dark' | 'deep'
export type PastelAccent = 'lavender' | 'mint' | 'sky' | 'peach' | 'lemon'
export type DeepAccent = 'indigo' | 'emerald' | 'rose' | 'cobalt' | 'purple'

type ThemeState = { theme: ThemeFamily; accent: PastelAccent; deepaccent: DeepAccent }

const KEY_THEME = 'byb_theme'
const KEY_ACCENT = 'byb_accent'
const KEY_DEEP = 'byb_deepaccent'

const defaultState: ThemeState = { theme: 'pastel', accent: 'lavender', deepaccent: 'indigo' }

function readLocal(): ThemeState {
  try {
    const theme = (localStorage.getItem(KEY_THEME) as ThemeFamily) || defaultState.theme
    const accent = (localStorage.getItem(KEY_ACCENT) as PastelAccent) || defaultState.accent
    const deepaccent = (localStorage.getItem(KEY_DEEP) as DeepAccent) || defaultState.deepaccent
    return { theme, accent, deepaccent }
  } catch {
    return defaultState
  }
}

function writeLocal(s: ThemeState) {
  try {
    localStorage.setItem(KEY_THEME, s.theme)
    localStorage.setItem(KEY_ACCENT, s.accent)
    localStorage.setItem(KEY_DEEP, s.deepaccent)
  } catch {}
}

function applyToDOM(s: ThemeState) {
  const root = document.documentElement as HTMLElement & {
    dataset: DOMStringMap & { theme?: ThemeFamily; accent?: PastelAccent; deepaccent?: DeepAccent }
  }
  root.dataset.theme = s.theme
  if (s.theme === 'pastel') {
    if (s.accent === 'lavender') delete root.dataset.accent
    else root.dataset.accent = s.accent
    delete root.dataset.deepaccent
  } else if (s.theme === 'deep') {
    delete root.dataset.accent
    root.dataset.deepaccent = s.deepaccent
  } else {
    delete root.dataset.accent
    delete root.dataset.deepaccent
  }
}

const PASTEL: { value: PastelAccent; label: string }[] = [
  { value: 'lavender', label: 'Lavender' },
  { value: 'mint', label: 'Mint' },
  { value: 'sky', label: 'Sky' },
  { value: 'peach', label: 'Peach' },
  { value: 'lemon', label: 'Lemon' }
]

const DEEP: { value: DeepAccent; label: string }[] = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'cobalt', label: 'Cobalt' },
  { value: 'purple', label: 'Purple' }
]

const FAMILIES: { value: ThemeFamily; label: string; desc?: string }[] = [
  { value: 'pastel', label: 'Pastel', desc: 'Light, soft surfaces with gentle washes' },
  { value: 'mono-light', label: 'Monochrome (Light)', desc: 'Clean grayscale, no accents' },
  { value: 'mono-dark', label: 'Monochrome (Dark)', desc: 'Dim grayscale, high legibility' },
  { value: 'deep', label: 'Deep', desc: 'Vivid, high-contrast with rich accents' }
]

export default function ProfileAppearanceCard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [state, setState] = useState<ThemeState>(defaultState)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Initial paint: apply cached theme ASAP to avoid FOUC
  useEffect(() => {
    const cached = readLocal()
    setState(cached)
    applyToDOM(cached)
  }, [])

  // Load from Supabase profile (overrides local if present)
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      const uid = data.user?.id ?? null
      setUserId(uid)
      if (!uid) return
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('theme, accent, deepaccent')
        .eq('id', uid)
        .maybeSingle()
      if (!error && prof) {
        const merged: ThemeState = {
          theme: (prof.theme as ThemeFamily) || state.theme,
          accent: (prof.accent as PastelAccent) || state.accent,
          deepaccent: (prof.deepaccent as DeepAccent) || state.deepaccent
        }
        setState(merged)
        applyToDOM(merged)
        writeLocal(merged)
      }
    })()
  }, [])

  // Live-apply and persist locally on change
  useEffect(() => {
    applyToDOM(state)
    writeLocal(state)
  }, [state])

  async function save() {
    if (!userId) return
    setSaving(true)
    setMsg(null)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ theme: state.theme, accent: state.accent, deepaccent: state.deepaccent })
        .eq('id', userId)
      if (error) throw error
      setMsg('Theme saved ✔')
      setTimeout(() => setMsg(null), 1500)
    } catch (e: any) {
      setMsg(e.message || 'Error saving theme')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0 }}>Appearance</h2>
      <div className="section-title">Theme family</div>
      <div className="settings-grid" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {FAMILIES.map((t) => (
          <label key={t.value} className="item" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0 }}>
            <input
              type="radio"
              name="theme"
              value={t.value}
              checked={state.theme === t.value}
              onChange={() => setState((s) => ({ ...s, theme: t.value }))}
            />
            <div style={{ display: 'grid' }}>
              <strong>{t.label}</strong>
              {t.desc && <span className="muted" style={{ fontSize: 12 }}>{t.desc}</span>}
            </div>
          </label>
        ))}
      </div>

      {state.theme === 'pastel' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="section-title">Pastel accent</div>
          <div className="settings-grid" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {PASTEL.map((a) => (
              <label key={a.value} className="item" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0 }}>
                <input
                  type="radio"
                  name="accent"
                  value={a.value}
                  checked={state.accent === a.value}
                  onChange={() => setState((s) => ({ ...s, accent: a.value }))}
                />
                <span>{a.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {state.theme === 'deep' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="section-title">Deep accent</div>
          <div className="settings-grid" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {DEEP.map((a) => (
              <label key={a.value} className="item" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0 }}>
                <input
                  type="radio"
                  name="deepaccent"
                  value={a.value}
                  checked={state.deepaccent === a.value}
                  onChange={() => setState((s) => ({ ...s, deepaccent: a.value }))}
                />
                <span className="capitalize">{a.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={save} disabled={saving} style={{ borderRadius: 8 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {msg && <div className="muted">{msg}</div>}
    </div>
  )
}
