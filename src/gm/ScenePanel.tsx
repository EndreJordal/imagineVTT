import { useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { areaCentre } from '../shared/hidden'
import { waterCentre } from '../shared/water'
import { sceneBounds } from '../shared/geometry'
import { isParty } from '../shared/levels'
import { LIGHT_PRESETS, lightName, type Light } from '../shared/lights'
import type { CharacterToken } from '../shared/characters'
import type { Point } from '../shared/types'
import type { GmCanvas } from './GmCanvas'
import { Icon, LightKindIcon } from './icons'
import { groupMembers, liveGroups } from './slices/groups'
import { useGm } from './store'

const COLLAPSED_KEY = 'imaginevtt.scenePanel.collapsed'

function loadCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The right-hand list of what's on the floor viewed: groups, objects, lights, vision tokens and
 * hidden areas. Click to select (a group: all of it), double-click to go to it; double-click a
 * name to rename it. Objects, lights and character tokens select like files in a file explorer:
 * Ctrl+click adds or takes one, Shift+click selects everything between. Collapses to a strip.
 */
export function ScenePanel({ canvas }: { canvas: RefObject<GmCanvas | null> }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const scene = useGm((s) => s.scene)
  const selectedLights = useGm((s) => s.selectedLightIds)
  const selectedObjects = useGm((s) => s.selectedObjectIds)
  const selectedHidden = useGm((s) => s.selectedHiddenId)
  const selectedSound = useGm((s) => s.selectedSoundId)
  const selectedWater = useGm((s) => s.selectedWaterIds)
  const selectedCharacters = useGm((s) => s.selectedCharacterIds)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  /** The row Shift+click selects from (the last one clicked without Shift). */
  const anchor = useRef<string | null>(null)
  const toggleCollapsed = () => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1')
    } catch {
      // not remembered, that's all
    }
  }

  if (collapsed) {
    return (
      <aside className="scene-panel collapsed">
        <button className="icon-button" title="Show the scene list" onClick={toggleCollapsed}>
          <Icon name="left" />
        </button>
        <span className="scene-panel-strip">Scene</span>
      </aside>
    )
  }

  const gm = useGm.getState()
  const goTo = (p: Point) => canvas.current?.centreOn(p)
  const bounds = sceneBounds(scene)
  const groups = liveGroups(scene)
  const lights = scene.lights.filter((l) => !l.vision || LIGHT_PRESETS[l.kind].shape !== 'none')
  const viewers = scene.lights.filter((l) => l.vision && LIGHT_PRESETS[l.kind].shape === 'none')
  const hidden = scene.hiddenAreas ?? []
  const byName = <T extends { name?: string }>(a: T, b: T) =>
    (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true })
  const objects = [...scene.objects].sort(byName)
  const sortedLights = [...lights].sort((a, b) => lightName(a).localeCompare(lightName(b), undefined, { numeric: true }))
  const characters = [...(scene.characters ?? [])].sort(byName)
  const waters = [...(scene.waterAreas ?? [])].sort(byName)

  // What can be selected together, in the order the list shows it (for Shift+click ranges).
  type Kind = 'object' | 'light' | 'character' | 'water'
  const order: { kind: Kind; id: string }[] = [
    ...objects.map((o) => ({ kind: 'object' as const, id: o.id })),
    ...[...sortedLights, ...viewers].map((l) => ({ kind: 'light' as const, id: l.id })),
    ...characters.map((t) => ({ kind: 'character' as const, id: t.id })),
    ...waters.map((w) => ({ kind: 'water' as const, id: w.id })),
  ]
  const keyOf = (kind: Kind, id: string) => `${kind}:${id}`
  /** A click on a row: alone (`only`), or with Ctrl or Shift, added to or ranged with the selection. */
  const pick = (kind: Kind, id: string, e: MouseEvent, only: () => void) => {
    const add = e.ctrlKey || e.metaKey
    const chosen = {
      object: new Set(add ? selectedObjects : []),
      light: new Set(add ? selectedLights : []),
      character: new Set(add ? selectedCharacters : []),
      water: new Set(add ? selectedWater : []),
    }
    const select = () =>
      gm.selectMany([...chosen.light], [], [...chosen.object], false, [...chosen.character], [...chosen.water])
    const from = order.findIndex((x) => keyOf(x.kind, x.id) === anchor.current)
    const to = order.findIndex((x) => x.kind === kind && x.id === id)
    if (e.shiftKey && from >= 0 && to >= 0) {
      for (const x of order.slice(Math.min(from, to), Math.max(from, to) + 1)) chosen[x.kind].add(x.id)
      return select()
    }
    anchor.current = keyOf(kind, id)
    if (!add) return only()
    if (chosen[kind].has(id)) chosen[kind].delete(id)
    else chosen[kind].add(id)
    select()
  }

  const lightRow = (l: Light) => (
    <Row
      key={l.id}
      icon={<LightKindIcon icon={LIGHT_PRESETS[l.kind].icon} size={14} />}
      name={lightName(l)}
      selected={selectedLights.includes(l.id)}
      dim={!l.on && !l.vision}
      note={isParty(l) ? 'party' : undefined}
      onSelect={(e) => pick('light', l.id, e, () => gm.selectLight(l.id))}
      onGo={() => goTo(l)}
      onRename={(name) => gm.updateLight(l.id, { name })}
    />
  )

  const characterRow = (t: CharacterToken) => (
    <Row
      key={t.id}
      icon={<Icon name="character" size={14} />}
      name={t.name}
      selected={selectedCharacters.includes(t.id)}
      dim={!t.visible}
      note={t.visible ? t.type : 'hidden'}
      onSelect={(e) => pick('character', t.id, e, () => gm.selectCharacter(t.id))}
      onGo={() => goTo(t)}
      onRename={(name) => gm.updateCharacter(t.id, { name })}
    />
  )

  return (
    <aside className="scene-panel" aria-label="Scene">
      <header>
        <span className="light-panel-title">Scene</span>
        <button className="icon-button" title="Hide the scene list" onClick={toggleCollapsed}>
          <Icon name="right" />
        </button>
      </header>
      <div className="scene-list">
        {groups.length > 0 && (
          <List title="Groups">
            {groups.map((g) => {
              const m = groupMembers(scene, g.id)
              const count = m.lights.length + m.objects.length + m.hidden.length + m.characters.length + m.water.length
              const selected =
                (m.lights.length || m.objects.length || m.characters.length || m.water.length) > 0 &&
                m.lights.every((l) => selectedLights.includes(l.id)) &&
                m.objects.every((o) => selectedObjects.includes(o.id)) &&
                m.characters.every((t) => selectedCharacters.includes(t.id)) &&
                m.water.every((w) => selectedWater.includes(w.id))
              return (
                <li key={g.id}>
                  <Row
                    icon={
                      <button
                        className="scene-caret"
                        aria-expanded={!!open[g.id]}
                        title={open[g.id] ? 'Fold' : 'Unfold'}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpen({ ...open, [g.id]: !open[g.id] })
                        }}
                      >
                        <Icon name={open[g.id] ? 'chevron-down' : 'right'} size={12} />
                      </button>
                    }
                    name={g.name}
                    note={String(count)}
                    selected={selected}
                    onSelect={() => gm.selectGroup(g.id)}
                    onGo={() => {
                      const first = m.objects[0] ?? m.lights[0] ?? m.characters[0]
                      if (first) goTo(first)
                      else if (m.water[0]) goTo(waterCentre(m.water[0], bounds))
                    }}
                    onRename={(name) => gm.renameGroup(g.id, name)}
                    action={{ label: 'Ungroup', run: () => gm.ungroup(g.id) }}
                    bare
                  />
                  {open[g.id] && (
                    <ul className="scene-members">
                      {m.objects.map((o) => (
                        <Row
                          key={o.id}
                          name={o.name}
                          selected={selectedObjects.includes(o.id)}
                          onSelect={(e) => pick('object', o.id, e, () => gm.selectObject(o.id))}
                          onGo={() => goTo(o)}
                          onRename={(name) => gm.updateObject(o.id, { name })}
                        />
                      ))}
                      {m.lights.map(lightRow)}
                      {m.characters.map(characterRow)}
                      {m.water.map((w) => (
                        <Row
                          key={w.id}
                          icon={<Icon name="water" size={14} />}
                          name={w.name}
                          selected={selectedWater.includes(w.id)}
                          onSelect={(e) => pick('water', w.id, e, () => gm.selectWater(w.id))}
                          onGo={() => goTo(waterCentre(w, bounds))}
                          onRename={(name) => gm.updateWater(w.id, { name })}
                        />
                      ))}
                      {m.hidden.map((a) => (
                        <Row
                          key={a.id}
                          icon={<Icon name="hide" size={14} />}
                          name={a.name ?? 'Hidden area'}
                          selected={selectedHidden === a.id}
                          onSelect={() => gm.selectHidden(a.id)}
                          onGo={() => goTo(areaCentre(a, bounds))}
                          onRename={(name) => gm.updateHidden(a.id, { name })}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </List>
        )}
        <List title="Objects" empty="Drag assets onto the map from the library.">
          {objects.map((o) => (
            <Row
              key={o.id}
              name={o.name}
              selected={selectedObjects.includes(o.id)}
              dim={o.visibility === 'hidden' && !o.seen}
              note={o.group ? groupName(groups, o.group) : undefined}
              onSelect={(e) => pick('object', o.id, e, () => gm.selectObject(o.id))}
              onGo={() => goTo(o)}
              onRename={(name) => gm.updateObject(o.id, { name })}
            />
          ))}
        </List>
        <List title="Lights" empty="Place lights with the light tool (L).">
          {sortedLights.map(lightRow)}
        </List>
        {viewers.length > 0 && <List title="Vision tokens">{viewers.map(lightRow)}</List>}
        <List title="Hidden areas" empty="Hide areas with the hide tool (H).">
          {[...hidden].sort(byName).map((a) => (
            <Row
              key={a.id}
              icon={<Icon name="hide" size={14} />}
              name={a.name ?? 'Hidden area'}
              selected={selectedHidden === a.id}
              dim={a.active === false}
              note={a.group ? groupName(groups, a.group) : undefined}
              onSelect={() => gm.selectHidden(a.id)}
              onGo={() => goTo(areaCentre(a, bounds))}
              onRename={(name) => gm.updateHidden(a.id, { name })}
            />
          ))}
        </List>
        <List
          title="Characters"
          empty="Add character tokens from the sidebar (Character tokens)."
          onTitleClick={() => gm.selectCharacters((scene.characters ?? []).map((t) => t.id))}
          titleHint="Select all the character tokens on this floor"
        >
          {characters.map(characterRow)}
        </List>
        <List title="Water" empty="Paint water with the water tool (K).">
          {waters.map((w) => (
            <Row
              key={w.id}
              icon={<Icon name="water" size={14} />}
              name={w.name}
              selected={selectedWater.includes(w.id)}
              dim={w.active === false}
              note={w.group ? groupName(groups, w.group) : w.sound ? 'sound' : undefined}
              onSelect={(e) => pick('water', w.id, e, () => gm.selectWater(w.id))}
              onGo={() => goTo(waterCentre(w, bounds))}
              onRename={(name) => gm.updateWater(w.id, { name })}
            />
          ))}
        </List>
        <List title="Sounds" empty="Drag sounds onto the map from the library (Assets, Audio).">
          {[...(scene.sounds ?? [])].sort(byName).map((x) => (
            <Row
              key={x.id}
              icon={<Icon name="sound" size={14} />}
              name={x.name}
              selected={selectedSound === x.id}
              dim={!x.enabled}
              note={x.loop ? 'loop' : undefined}
              onSelect={() => gm.selectSound(x.id)}
              onGo={() => goTo(x)}
              onRename={(name) => gm.updateSound(x.id, { name })}
            />
          ))}
        </List>
      </div>
    </aside>
  )
}

const groupName = (groups: { id: string; name: string }[], id: string) => groups.find((g) => g.id === id)?.name

function List(props: {
  title: string
  empty?: string
  /** Clicking the heading (selects everything in the list). */
  onTitleClick?: () => void
  titleHint?: string
  children: ReactNode[] | ReactNode
}) {
  const items = Array.isArray(props.children) ? props.children : [props.children]
  const heading = (
    <>
      {props.title} <span className="scene-count">{items.length}</span>
    </>
  )
  return (
    <section className="scene-section">
      <h3>
        {props.onTitleClick && items.length ? (
          <button className="scene-heading" title={props.titleHint} onClick={props.onTitleClick}>
            {heading}
          </button>
        ) : (
          heading
        )}
      </h3>
      {items.length ? <ul>{props.children}</ul> : props.empty && <p className="hint">{props.empty}</p>}
    </section>
  )
}

/** One thing in the list: click selects, double-click goes to it; its name renames in place. */
function Row(props: {
  name: string
  icon?: ReactNode
  note?: string
  selected?: boolean
  dim?: boolean
  bare?: boolean
  onSelect(e: MouseEvent): void
  onGo(): void
  onRename(name: string): void
  action?: { label: string; run(): void }
}) {
  const [editing, setEditing] = useState(false)
  const commit = (value: string) => {
    const name = value.trim()
    if (name && name !== props.name) props.onRename(name)
    setEditing(false)
  }
  const row = (
    <div
      className={`scene-row${props.selected ? ' selected' : ''}${props.dim ? ' dim' : ''}`}
      onClick={props.onSelect}
      // Shift+click selects a range: don't let it highlight the text too.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onDoubleClick={props.onGo}
      title="Click to select (Ctrl+click: add or take one, Shift+click: everything between), double-click to go to it"
    >
      {props.icon}
      {editing ? (
        <input
          className="scene-rename"
          defaultValue={props.name}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className="scene-name"
          title="Double-click to rename"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
        >
          {props.name}
        </span>
      )}
      {props.note && <span className="scene-note">{props.note}</span>}
      {props.action && (
        <button
          className="scene-action"
          onClick={(e) => {
            e.stopPropagation()
            props.action!.run()
          }}
        >
          {props.action.label}
        </button>
      )}
    </div>
  )
  return props.bare ? row : <li>{row}</li>
}

/**
 * Under the selection's panels: group what's selected, or ungroup the group that's selected.
 */
export function GroupBar() {
  const scene = useGm((s) => s.scene)
  const lights = useGm((s) => s.selectedLightIds)
  const objects = useGm((s) => s.selectedObjectIds)
  const hidden = useGm((s) => s.selectedHiddenId)
  const characters = useGm((s) => s.selectedCharacterIds)
  const water = useGm((s) => s.selectedWaterIds)
  const groupable =
    characters.length +
    water.length +
    lights.filter((id) => {
      const l = scene.lights.find((x) => x.id === id)
      return l && !isParty(l)
    }).length +
    objects.length +
    (hidden ? 1 : 0)
  const picked = [
    ...scene.lights.filter((l) => lights.includes(l.id)),
    ...scene.objects.filter((o) => objects.includes(o.id)),
    ...(scene.characters ?? []).filter((t) => characters.includes(t.id)),
    ...(scene.waterAreas ?? []).filter((w) => water.includes(w.id)),
  ]
  const group = picked.length && picked.every((x) => x.group && x.group === picked[0].group) ? picked[0].group : null
  const groupInfo = group ? (scene.groups ?? []).find((g) => g.id === group) : null
  if (groupInfo) {
    return (
      <div className="group-bar">
        <span>
          Group <b>{groupInfo.name}</b>
        </span>
        <button onClick={() => useGm.getState().ungroup(groupInfo.id)}>Ungroup</button>
      </div>
    )
  }
  if (groupable < 2) return null
  return (
    <div className="group-bar">
      <button onClick={() => useGm.getState().groupSelection()}>Group selection ({groupable})</button>
    </div>
  )
}
