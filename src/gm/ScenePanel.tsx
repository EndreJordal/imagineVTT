import { useState, type ReactNode, type RefObject } from 'react'
import { areaCentre } from '../shared/hidden'
import { sceneBounds } from '../shared/geometry'
import { isParty } from '../shared/levels'
import { LIGHT_PRESETS, lightName, type Light } from '../shared/lights'
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
 * name to rename it. Collapses to a strip.
 */
export function ScenePanel({ canvas }: { canvas: RefObject<GmCanvas | null> }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const scene = useGm((s) => s.scene)
  const selectedLights = useGm((s) => s.selectedLightIds)
  const selectedObjects = useGm((s) => s.selectedObjectIds)
  const selectedHidden = useGm((s) => s.selectedHiddenId)
  const selectedSound = useGm((s) => s.selectedSoundId)
  const [open, setOpen] = useState<Record<string, boolean>>({})
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

  const lightRow = (l: Light) => (
    <Row
      key={l.id}
      icon={<LightKindIcon icon={LIGHT_PRESETS[l.kind].icon} size={14} />}
      name={lightName(l)}
      selected={selectedLights.includes(l.id)}
      dim={!l.on && !l.vision}
      note={isParty(l) ? 'party' : undefined}
      onSelect={() => gm.selectLight(l.id)}
      onGo={() => goTo(l)}
      onRename={(name) => gm.updateLight(l.id, { name })}
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
              const count = m.lights.length + m.objects.length + m.hidden.length
              const selected =
                (m.lights.length || m.objects.length) > 0 &&
                m.lights.every((l) => selectedLights.includes(l.id)) &&
                m.objects.every((o) => selectedObjects.includes(o.id))
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
                      const first = m.objects[0] ?? m.lights[0]
                      if (first) goTo(first)
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
                          onSelect={() => gm.selectObject(o.id)}
                          onGo={() => goTo(o)}
                          onRename={(name) => gm.updateObject(o.id, { name })}
                        />
                      ))}
                      {m.lights.map(lightRow)}
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
          {[...scene.objects].sort(byName).map((o) => (
            <Row
              key={o.id}
              name={o.name}
              selected={selectedObjects.includes(o.id)}
              dim={o.visibility === 'hidden' && !o.seen}
              note={o.group ? groupName(groups, o.group) : undefined}
              onSelect={() => gm.selectObject(o.id)}
              onGo={() => goTo(o)}
              onRename={(name) => gm.updateObject(o.id, { name })}
            />
          ))}
        </List>
        <List title="Lights" empty="Place lights with the light tool (L).">
          {[...lights].sort((a, b) => lightName(a).localeCompare(lightName(b), undefined, { numeric: true })).map(lightRow)}
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

function List(props: { title: string; empty?: string; children: ReactNode[] | ReactNode }) {
  const items = Array.isArray(props.children) ? props.children : [props.children]
  return (
    <section className="scene-section">
      <h3>
        {props.title} <span className="scene-count">{items.length}</span>
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
  onSelect(): void
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
      onDoubleClick={props.onGo}
      title="Click to select, double-click to go to it"
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
  const groupable =
    lights.filter((id) => {
      const l = scene.lights.find((x) => x.id === id)
      return l && !isParty(l)
    }).length +
    objects.length +
    (hidden ? 1 : 0)
  const picked = [
    ...scene.lights.filter((l) => lights.includes(l.id)),
    ...scene.objects.filter((o) => objects.includes(o.id)),
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
