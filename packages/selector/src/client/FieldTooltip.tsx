/**
 * FieldTooltip: per-parameter help tooltip with ? icon.
 *
 * Plan: cci-longterm-refactor v0.14.2 (F21)
 *
 * Shows on hover/focus. Content includes: one-line purpose, default, range,
 * effect of increase/decrease, and whether the field is session-frozen.
 *
 * @module dsh-context-compression-improved/client/FieldTooltip
 */
import { useState, type ReactNode } from 'react'

export interface FieldTooltipProps {
  readonly purpose: string
  readonly defaultValue: string
  readonly range: string
  readonly effect: string
  readonly frozen?: boolean
  readonly children: ReactNode
}

export function FieldTooltip({ purpose, defaultValue, range, effect, frozen = false, children }: FieldTooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {children}
      <button
        type="button"
        aria-label={`Help: ${purpose}`}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        style={{ background: 'none', border: '1px solid currentColor', borderRadius: '50%', width: 16, height: 16, fontSize: 10, cursor: 'help', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}
      >
        ?
      </button>
      {visible ? (
        <div role="tooltip" style={{ position: 'absolute', bottom: '120%', left: 0, zIndex: 100, background: 'var(--surface-raised, #fff)', border: '1px solid #ccc', borderRadius: 6, padding: '8px 12px', fontSize: '0.8em', lineHeight: 1.5, maxWidth: 280, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
          <div><strong>{purpose}</strong></div>
          <div>默认: {defaultValue} · 范围: {range}</div>
          <div>{effect}</div>
          {frozen ? <div style={{ marginTop: 4, opacity: 0.7 }}>🔒 修改仅影响新会话（重启生效）</div> : null}
        </div>
      ) : null}
    </span>
  )
}
