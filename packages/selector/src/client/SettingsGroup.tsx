/**
 * SettingsGroup: collapsible section container for the refactored settings panel.
 *
 * Plan: cci-longterm-refactor v0.14.2 (F22)
 *
 * Renders a titled, collapsible region with an "N modified" badge
 * when child values differ from their defaults.
 *
 * @module dsh-context-compression-improved/client/SettingsGroup
 */
import { useState, type ReactNode } from 'react'

export interface SettingsGroupProps {
  readonly title: string
  readonly badge?: string
  readonly defaultOpen: boolean
  readonly modifiedCount?: number
  readonly children: ReactNode
}

/** Persistent collapse state via localStorage key derived from title. */
function storageKey(title: string): string {
  return `cci-group-${title.toLowerCase().replace(/\s+/g, '-')}`
}

export function SettingsGroup({ title, badge, defaultOpen, modifiedCount = 0, children }: SettingsGroupProps) {
  const key = storageKey(title)
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? stored === '1' : defaultOpen
    } catch { return defaultOpen }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* private mode */ }
  }

  return (
    <section style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontWeight: 600, fontSize: '0.95em' }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {badge ? <span style={{ fontSize: '0.75em', opacity: 0.7, marginLeft: 4 }}>[{badge}]</span> : null}
        {modifiedCount > 0 ? (
          <span style={{ fontSize: '0.75em', background: 'var(--accent, #5b8def)', color: '#fff', borderRadius: 10, padding: '1px 6px', marginLeft: 6 }}>
            {modifiedCount} 项已修改
          </span>
        ) : null}
      </button>
      {open ? <div style={{ paddingLeft: 12 }}>{children}</div> : null}
    </section>
  )
}
