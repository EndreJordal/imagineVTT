import { useMemo } from 'react'
import { BORDERS, DEFAULT_SLIDE, seenTokens, type CharacterLabel, type CharacterToken } from '../shared/characters'
import type { CharacterLook } from './slices/characters'
import { FolderPictures } from './FolderPictures'
import { Icon } from './icons'
import { portraitFolder, setPortrait, usePortraits } from './portraits'
import { useGm } from './store'
import { Section, Slider, Switch } from './ui'

const LABELS: { value: CharacterLabel; text: string; title: string }[] = [
  { value: 'name', text: 'Name', title: 'Write its name at the bottom of its square' },
  { value: 'type', text: 'Type', title: 'Write its type at the bottom of its square' },
  { value: 'both', text: 'Both', title: 'The name, with the type under it' },
  { value: 'none', text: 'None', title: 'No text on the token' },
]

const borderUrl = (id: string) => `${import.meta.env.BASE_URL}borders/${id}.png`

/** Sidebar section: placing character tokens, how new ones look, and how fast tokens move. */
export function CharactersSection() {
  const look = useGm((s) => s.newCharacterLook)
  const slide = useGm((s) => s.scene.characterSlide ?? DEFAULT_SLIDE)
  const turn = useGm((s) => s.scene.characterTurn ?? 0)
  const { setNewCharacterLook, setCharacterSlide, addCharacter, turnCharacters } = useGm.getState()
  return (
    <Section title="Character tokens">
      <p className="hint">
        Tokens for the people the party meets. Drag them, or move the selected one with the arrow keys.
      </p>
      <button onClick={() => addCharacter(useGm.getState().scene.view)}>
        <Icon name="add" /> Add character token
      </button>
      <span className="slider-label">New tokens</span>
      <BorderPicker value={look} onChange={setNewCharacterLook} />
      <SizePicker value={look.size} onChange={(size) => setNewCharacterLook({ size })} />
      <Slider
        label="Move time"
        unit="s"
        value={slide}
        fallback={DEFAULT_SLIDE}
        min={0}
        max={3}
        step={0.05}
        title="How long a token takes to slide to where it's moved (each token can have its own)"
        onChange={setCharacterSlide}
      />
      <span className="slider-label">Turn all tokens</span>
      <div className="row handout-turns">
        <button className="icon-button" title="Turn all tokens 90° left" onClick={() => turnCharacters(-1)}>
          <Icon name="turn-left" />
        </button>
        <button title="Turn all tokens 180°" onClick={() => turnCharacters(2)}>
          180°
        </button>
        <button className="icon-button" title="Turn all tokens 90° right" onClick={() => turnCharacters(1)}>
          <Icon name="turn-right" />
        </button>
        <span className="hint">{turn * 90}°</span>
      </div>
    </Section>
  )
}

/** Floating panel for the selected character token. */
export function CharacterPanel() {
  const token = useGm((s) =>
    s.selectedCharacterIds.length === 1 ? s.scene.characters?.find((t) => t.id === s.selectedCharacterIds[0]) : undefined,
  )
  const sceneSlide = useGm((s) => s.scene.characterSlide ?? DEFAULT_SLIDE)
  const scene = useGm((s) => s.scene)
  // What decides whether the players see it (not every scene change: drags are many).
  const { characters, lights, walls, fog, darkness, hiddenAreas, hiddenEnabled, grid, map } = scene
  const seenIds = useMemo(
    () => seenTokens(scene),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [characters, lights, walls, fog, darkness, hiddenAreas, hiddenEnabled, grid, map],
  )
  const seen = !!token && seenIds.has(token.id)
  const portraits = usePortraits()
  if (!token) return null
  const { selectCharacter, updateCharacter, removeCharacter } = useGm.getState()
  const set = (patch: Partial<CharacterToken>) => updateCharacter(token.id, patch)
  const portraitId = token.portrait?.replace(/^portrait:/, '') ?? null

  return (
    <aside className="light-panel character-panel" aria-label="Character token">
      <header>
        <input
          className="panel-name"
          aria-label="Name"
          value={token.name}
          readOnly={!!token.ref}
          title={token.ref ? 'The name comes from the combat tracker: rename it there' : undefined}
          onChange={(e) => set({ name: e.target.value })}
        />
        <button className="icon-button" title="Close" onClick={() => selectCharacter(null)}>
          <Icon name="close" />
        </button>
      </header>
      <input
        aria-label="Type"
        placeholder="Type (Goblin archer, Innkeeper…)"
        value={token.type ?? ''}
        onChange={(e) => set({ type: e.target.value })}
      />
      <span className="slider-label">Display</span>
      <div className="segmented" role="radiogroup" aria-label="Display">
        {LABELS.map((l) => (
          <button
            key={l.value}
            role="radio"
            aria-checked={(token.label ?? 'none') === l.value}
            className={(token.label ?? 'none') === l.value ? 'active' : ''}
            title={l.title}
            onClick={() => set({ label: l.value })}
          >
            {l.text}
          </button>
        ))}
      </div>
      <Switch
        left="Hidden"
        right="Visible"
        on={token.visible}
        title="Visible: the players see it when it's in their sight and lit"
        onChange={(visible) => set({ visible })}
      />
      {token.visible && !seen && (
        <p className="hint">The players can’t see it now: it’s out of their sight, or in the dark.</p>
      )}
      <SizePicker value={token.size} onChange={(size) => set({ size })} />
      <label className="check" title="Moves settle in the middle of a square (a 2 × 2 token: on a grid corner)">
        <input type="checkbox" checked={token.snap} onChange={(e) => set({ snap: e.target.checked })} />
        Snap to grid
      </label>
      <span className="slider-label">Border</span>
      <BorderPicker value={token} onChange={set} />

      <span className="slider-label">Portrait</span>
      <FolderPictures
        state={{ ...portraits, selectedId: portraitId }}
        folder={portraitFolder}
        what="portraits"
        ns="portrait:"
        onSelect={(id) => void setPortrait(token.id, id)}
      />
      {token.portrait && (
        <>
          <Slider
            label="Zoom"
            unit="×"
            value={token.zoom}
            fallback={1}
            min={1}
            max={4}
            step={0.05}
            onChange={(zoom) => set({ zoom })}
          />
          <Slider
            label="Left–right"
            value={token.offsetX}
            fallback={0}
            min={-0.5}
            max={0.5}
            step={0.01}
            onChange={(offsetX) => set({ offsetX })}
          />
          <Slider
            label="Up–down"
            value={token.offsetY}
            fallback={0}
            min={-0.5}
            max={0.5}
            step={0.01}
            onChange={(offsetY) => set({ offsetY })}
          />
          <div className="row">
            <button onClick={() => set({ zoom: 1, offsetX: 0, offsetY: 0 })}>Centre</button>
            <button onClick={() => set({ portrait: undefined })}>No portrait</button>
          </div>
        </>
      )}

      <label className="check" title="Its own move time, instead of the one for all tokens">
        <input
          type="checkbox"
          checked={token.slide !== undefined}
          onChange={(e) => set({ slide: e.target.checked ? sceneSlide : undefined })}
        />
        Own move time
      </label>
      {token.slide !== undefined && (
        <Slider
          label="Move time"
          unit="s"
          value={token.slide}
          fallback={sceneSlide}
          min={0}
          max={3}
          step={0.05}
          onChange={(slide) => set({ slide })}
        />
      )}
      <button onClick={() => removeCharacter(token.id)}>Remove</button>
    </aside>
  )
}

/** The one value all have, or undefined when they differ. */
function shared<T>(values: T[]): T | undefined {
  return values.every((v) => v === values[0]) ? values[0] : undefined
}

/** Floating panel for several selected tokens: what they share, changed for all at once. */
export function CharactersPanel() {
  const ids = useGm((s) => s.selectedCharacterIds)
  const all = useGm((s) => s.scene.characters)
  if (ids.length < 2) return null
  const tokens = (all ?? []).filter((t) => ids.includes(t.id))
  const { updateCharacters, removeCharacters, selectCharacter } = useGm.getState()
  const set = (patch: Partial<CharacterToken>) => updateCharacters(ids, patch)
  const visible = shared(tokens.map((t) => t.visible))
  const snap = shared(tokens.map((t) => t.snap))
  const size = shared(tokens.map((t) => t.size))
  const label = shared(tokens.map((t) => t.label ?? 'none'))

  return (
    <aside className="light-panel character-panel" aria-label="Character tokens">
      <header>
        <span className="light-panel-title">
          <Icon name="character" /> {tokens.length} tokens selected
        </span>
        <button className="icon-button" title="Close" onClick={() => selectCharacter(null)}>
          <Icon name="close" />
        </button>
      </header>
      <Switch
        left="Hidden"
        right="Visible"
        on={visible === true}
        title={visible === undefined ? 'Some are shown, some hidden: switch to show (or hide) them all' : undefined}
        onChange={(on) => set({ visible: on })}
      />
      {visible === undefined && <p className="hint">Some are shown to the players, some hidden.</p>}
      <span className="slider-label">Size{size === undefined ? ' (mixed)' : ''}</span>
      <SizePicker value={size ?? 0} onChange={(n) => set({ size: n })} />
      <span className="slider-label">Display{label === undefined ? ' (mixed)' : ''}</span>
      <div className="segmented" role="radiogroup" aria-label="Display">
        {LABELS.map((l) => (
          <button
            key={l.value}
            role="radio"
            aria-checked={label === l.value}
            className={label === l.value ? 'active' : ''}
            title={l.title}
            onClick={() => set({ label: l.value })}
          >
            {l.text}
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={snap === true}
          ref={(el) => {
            if (el) el.indeterminate = snap === undefined
          }}
          onChange={(e) => set({ snap: e.target.checked })}
        />
        Snap to grid
      </label>
      <p className="hint">Drag one to move them all (the arrow keys move them too). Group them with the bar below.</p>
      <button onClick={() => removeCharacters(ids)}>Remove {tokens.length} tokens</button>
    </aside>
  )
}

function SizePicker({ value, onChange }: { value: 0 | 1 | 2; onChange(size: 1 | 2): void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Size">
      {([1, 2] as const).map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          className={value === n ? 'active' : ''}
          onClick={() => onChange(n)}
        >
          {n === 1 ? '1 square' : '4 squares'}
        </button>
      ))}
    </div>
  )
}

/** The border pictures, and a plain ring in a colour of your own. */
function BorderPicker({
  value,
  onChange,
}: {
  value: Pick<CharacterLook, 'border' | 'color'>
  onChange(patch: Partial<CharacterLook>): void
}) {
  return (
    <div className="border-picker" role="radiogroup" aria-label="Border">
      {BORDERS.map((b) => (
        <button
          key={b.id}
          role="radio"
          aria-checked={value.border === b.id}
          className={`border-choice${value.border === b.id ? ' active' : ''}`}
          title={b.name}
          onClick={() => onChange({ border: b.id })}
        >
          <img src={borderUrl(b.id)} alt={b.name} draggable={false} />
        </button>
      ))}
      <span className={`border-choice plain${value.border === 'plain' ? ' active' : ''}`} title="Plain, in a colour">
        <button
          role="radio"
          aria-checked={value.border === 'plain'}
          aria-label="Plain"
          className="border-plain-ring"
          style={{ borderColor: value.color }}
          onClick={() => onChange({ border: 'plain' })}
        />
        <input
          type="color"
          aria-label="Plain border colour"
          value={value.color}
          onChange={(e) => onChange({ border: 'plain', color: e.target.value })}
        />
      </span>
    </div>
  )
}
