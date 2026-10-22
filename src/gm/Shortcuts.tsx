import { useEffect, useState } from 'react'
import { Icon } from './icons'

/** Every shortcut, by where it's used: shown by ? and in Settings. */
const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: 'Tools',
    keys: [
      ['Esc', 'Put the tool down (back to select and move); leave alert mode'],
      ['W', 'Build walls'],
      ['D', 'Build doors'],
      ['L', 'Add a light'],
      ['H', 'Hide areas'],
      ['K', 'Paint water'],
      ['M', 'Measure'],
      ['Enter / right-click', 'Finish what the tool is drawing (walls), else put it down'],
      ['Backspace', 'Building walls: take back the last point'],
      ['Alt', 'While painting: erase instead (hide, water). Measuring: no snapping'],
    ],
  },
  {
    group: 'The table',
    keys: [
      ['Hold V', 'Preview: see exactly what the players see'],
      ['C', 'Drop or raise the curtain'],
      ['Right-click', 'Alert mode: stop alerting'],
    ],
  },
  {
    group: 'Selecting and moving',
    keys: [
      ['Shift + drag', 'Select everything in a box'],
      ['Shift + click', 'Add to or take from the selection'],
      ['Alt + click', 'A grouped thing alone, not its group'],
      ['Ctrl + drag', 'Copy an object'],
      ['Arrow keys', 'Move the selected character tokens a square (Shift: half, if they don’t snap)'],
      ['Delete / Backspace', 'Remove what’s selected'],
      ['Right-click', 'A measurement: remove it. A door’s button: its settings'],
      ['Ctrl / Shift + click', 'Scene list: add one, or everything between'],
      ['Double-click', 'Scene list: go to it; its name: rename'],
    ],
  },
  {
    group: 'Scene',
    keys: [
      ['Ctrl + S', 'Save the scene'],
      ['Ctrl + O', 'Open a scene'],
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Y / Ctrl + Shift + Z', 'Redo'],
      ['?', 'This list'],
    ],
  },
]

/** The shortcuts as a list. */
export function ShortcutList() {
  return (
    <div className="shortcut-list">
      {SHORTCUTS.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <dl>
            {g.keys.map(([k, what]) => (
              <div key={k + what} className="shortcut">
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** Press ? for every shortcut, over the map; Esc, ? or a click closes it. */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === '?') setOpen((o) => !o)
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!open) return null
  return (
    <div className="shortcuts-overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setOpen(false)}>
      <div className="shortcuts-card" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Keyboard shortcuts</h2>
          <button className="icon-button" title="Close (Esc)" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </header>
        <ShortcutList />
      </div>
    </div>
  )
}
