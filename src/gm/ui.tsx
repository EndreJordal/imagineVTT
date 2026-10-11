import { useState, type ReactNode } from 'react'

const COLLAPSED_KEY = 'imaginevtt.collapsedSections'

function loadCollapsed(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function saveCollapsed(titles: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(titles))
  } catch {
    // Storage unavailable (private window etc.): sections just open fully next time.
  }
}

/** A sidebar section that folds away by clicking its title; remembered per browser. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed().includes(title))
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    const others = loadCollapsed().filter((t) => t !== title)
    saveCollapsed(next ? [...others, title] : others)
  }
  return (
    <section className={collapsed ? 'collapsed' : ''}>
      <h2>
        <button className="section-toggle" aria-expanded={!collapsed} onClick={toggle}>
          <span className="chevron" aria-hidden>
            ▾
          </span>
          {title}
        </button>
      </h2>
      {!collapsed && children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/**
 * A slider with a number box beside it for typing an exact value. `scale` shows the value
 * scaled (100 shows 0..1 as a percentage). An undefined value shows as mixed.
 */
export function Slider(props: {
  label: string
  value: number | undefined
  /** Where the slider sits when the value is mixed. */
  fallback: number
  min: number
  max: number
  step: number
  scale?: number
  unit?: string
  disabled?: boolean
  title?: string
  onChange(value: number): void
}) {
  const scale = props.scale ?? 1
  // What's being typed, and the value it left in place; once the value changes from
  // elsewhere (the slider, undo) the typing is stale and the value shows again.
  const [draft, setDraft] = useState<{ text: string; value: number | undefined } | null>(null)
  const shown = props.value === undefined ? '' : String(round(props.value * scale, 2))
  const inRange = (v: number) => Number.isFinite(v) && v >= props.min && v <= props.max
  return (
    <div className="slider" title={props.title}>
      <span className="slider-label">{props.label}</span>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        value={props.value ?? props.fallback}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
      />
      <span className="slider-number">
        <input
          type="number"
          aria-label={`${props.label} value`}
          min={props.min * scale}
          max={props.max * scale}
          step={props.step * scale}
          disabled={props.disabled}
          placeholder={props.value === undefined ? 'mixed' : undefined}
          value={draft && draft.value === props.value ? draft.text : shown}
          onChange={(e) => {
            // Applied as soon as it's a valid value; until then it's just being typed.
            const v = e.target.valueAsNumber / scale
            const valid = inRange(v)
            setDraft({ text: e.target.value, value: valid ? v : props.value })
            if (valid) props.onChange(v)
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {props.unit && <span className="slider-unit">{props.unit}</span>}
      </span>
    </div>
  )
}

function round(n: number, digits: number) {
  return Math.round(n * 10 ** digits) / 10 ** digits
}
