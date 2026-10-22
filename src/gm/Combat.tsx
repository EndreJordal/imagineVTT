import { useEffect, useState, type RefObject } from 'react'
import { orderPlacement, type Combatant, type OrderEdge, type OrderFacing } from '../shared/combat'
import { BORDERS } from '../shared/characters'
import { resumeInTracker, startInTracker, trackerConnected } from './combatLink'
import { COMBATANT_DRAG_TYPE, PLACE_ALL, placeable } from './combatTokens'
import type { GmCanvas } from './GmCanvas'
import { Icon } from './icons'
import { useGm } from './store'
import { Section } from './ui'

const borderUrl = (id: string) => `${import.meta.env.BASE_URL}borders/${id}.png`

const PHASES: Record<string, string> = {
  setup: 'Setting up',
  declare: 'Declaring',
  act: 'Acting',
  extra: 'Extra actions',
  end: 'End of turn',
}

const EDGES: { value: OrderEdge; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'top', label: 'Top' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const FACINGS: { value: OrderFacing; label: string; title: string }[] = [
  { value: 'out', label: 'Outward', title: "Readable from that edge's side of the table" },
  { value: 'in', label: 'Inward', title: 'Readable from across the table' },
]

/**
 * Sidebar section: the fight linked to the scene. Its combatants, in order of initiative, as
 * coins to drag onto the map (to plan the fight, or as it starts); the tracker's state; and
 * whether the players see the order on the table.
 */
export function CombatSection({ canvas }: { canvas: RefObject<GmCanvas | null> }) {
  const combat = useGm((s) => s.combat)
  const tracker = useGm((s) => s.tracker)
  const tokens = useGm((s) => s.scene.characters)
  const turnMove = useGm((s) => s.turnMove)
  // The tracker counts as gone when it stops beating: look again now and then.
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(timer)
  }, [])

  if (!combat) {
    return (
      <Section id="combat" title="Combat">
        <p className="hint">
          No fight is linked to this scene. Start one from an encounter in the campaign bible (“Start in imagineVTT”).
        </p>
      </Section>
    )
  }

  const { setCombatOrder, selectCharacter, updateCharacter } = useGm.getState()
  const placement = orderPlacement(combat)
  const connected = trackerConnected(tracker.seen)
  const linked = connected && tracker.linkId === combat.linkId
  const summary = combat.summary
  const byId = new Map(summary?.combatants.map((c) => [c.id, c]))
  const inFight = (summary?.order ?? []).map((id) => byId.get(id)).filter((c): c is Combatant => !!c && !c.inactive)
  const waiting = (summary?.combatants ?? []).filter((c) => c.inactive)
  const active = summary?.activeId ? byId.get(summary.activeId) : null
  const tokenOf = (id: string) => tokens?.find((t) => t.ref === id)
  const unplaced = (summary?.combatants ?? []).filter((c) => placeable(c) && !tokenOf(c.id))

  const openTracker = () => {
    // The saved state if there is one; else the encounter, afresh.
    if (combat.snapshot) resumeInTracker(combat.linkId, combat.snapshot)
    else if (combat.payload) startInTracker(combat.linkId, combat.payload)
    else resumeInTracker(combat.linkId, null)
  }

  const row = (c: Combatant) => {
    const token = tokenOf(c.id)
    const look = c.vtt ?? {}
    const border = look.border && BORDERS.some((b) => b.id === look.border) ? look.border : null
    const ring = look.color ?? (c.allegiance === 'ally' ? '#2e8b57' : '#b03a2e')
    return (
      <li
        key={c.id}
        className={`combatant${c.id === summary?.activeId ? ' active' : ''}${c.acted ? ' acted' : ''}${c.state !== 'active' ? ' down' : ''}`}
      >
        <span
          className="coin"
          draggable={c.side === 'npc' || !!c.vtt}
          title={c.side === 'pc' && !c.vtt ? 'A player: the mini is on the table' : 'Drag onto the map to place its token (again to move it)'}
          onDragStart={(e) => {
            e.dataTransfer.setData(COMBATANT_DRAG_TYPE, c.id)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          style={border ? undefined : { borderColor: ring }}
        >
          {c.portrait ? <img src={c.portrait} alt="" draggable={false} /> : <span>{c.name.charAt(0)}</span>}
          {border && <img className="coin-border" src={borderUrl(border)} alt="" draggable={false} />}
        </span>
        <button
          className="combatant-name"
          title={token ? 'Select its token (and go to it)' : c.type}
          onClick={() => {
            if (!token) return
            selectCharacter(token.id)
            canvas.current?.centreOn(token)
          }}
        >
          <span>{c.name}</span>
          <span className="hint">
            {c.type}
            {c.state !== 'active' && ` · ${c.state}`}
            {turnMove?.ref === c.id && ` · moved ${Math.round(turnMove.squares)} yd`}
          </span>
        </button>
        <span className="combatant-init" title="Initiative">
          {c.init ?? '–'}
        </span>
        {token ? (
          <button
            className={`icon-button${token.visible ? ' active' : ''}`}
            title={token.visible ? 'Its token is shown to the players: click to hide it' : 'Its token is hidden: click to show it to the players'}
            onClick={() => updateCharacter(token.id, { visible: !token.visible })}
          >
            <Icon name={token.visible ? 'peek' : 'hide'} size={14} />
          </button>
        ) : (
          <span className="combatant-unplaced" title="Not on this floor's map yet" />
        )}
      </li>
    )
  }

  return (
    <Section id="combat" title={`Combat${active ? ` • ${active.name}` : ''}`}>
      <p className="combat-name">{combat.encounter}</p>
      <div className="row combat-tracker">
        <span className={`hint${linked ? ' ok' : ''}`}>
          {linked ? '● Tracker linked' : connected ? '● The tracker has another fight' : '○ Tracker not open'}
        </span>
        {!linked && (
          <button
            title={
              connected
                ? 'Bring this scene’s fight back into the tracker (it asks before replacing its fight)'
                : 'Open the tracker with this scene’s fight'
            }
            onClick={openTracker}
          >
            {connected ? 'Resume it there' : 'Open tracker'}
          </button>
        )}
      </div>
      {summary ? (
        <p className="hint">
          Turn {summary.round} · {PHASES[summary.phase] ?? summary.phase}
          {active && (
            <>
              : <b>{active.name}</b>
            </>
          )}
        </p>
      ) : (
        <p className="hint">Waiting for the tracker…</p>
      )}
      {unplaced.length > 1 && (
        <div className="combatant place-all">
          <span
            className="coin coin-stack"
            draggable
            title="Drag onto the map to place everyone not on it yet, in a block (all selected, to move or group)"
            onDragStart={(e) => {
              e.dataTransfer.setData(COMBATANT_DRAG_TYPE, PLACE_ALL)
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            {unplaced.length}
          </span>
          <span className="combatant-name">
            <span>Place all</span>
            <span className="hint">Drag onto the map: the {unplaced.length} not on it yet</span>
          </span>
        </div>
      )}
      {inFight.length > 0 && <ol className="combatants">{inFight.map(row)}</ol>}
      {waiting.length > 0 && (
        <>
          <span className="slider-label">Not in the fight yet</span>
          <ol className="combatants waiting">{waiting.map(row)}</ol>
        </>
      )}
      {summary && <p className="hint">Drag a coin onto the map to place its token, hidden until you show it (👁).</p>}
      <label className="check" title="The order of initiative along the table's edge, and a glow on whoever is acting">
        <input type="checkbox" checked={combat.showOrder} onChange={(e) => setCombatOrder({ showOrder: e.target.checked })} />
        Show the order to the players
      </label>
      {combat.showOrder && (
        <>
          <span className="slider-label">Along the table screen's edge</span>
          <div className="segmented" role="radiogroup" aria-label="Along the edge">
            {EDGES.map((e) => (
              <button
                key={e.value}
                role="radio"
                aria-checked={placement.edge === e.value}
                className={placement.edge === e.value ? 'active' : ''}
                onClick={() => setCombatOrder({ edge: e.value })}
              >
                {e.label}
              </button>
            ))}
          </div>
          <span className="slider-label">Facing</span>
          <div className="segmented" role="radiogroup" aria-label="Facing">
            {FACINGS.map((f) => (
              <button
                key={f.value}
                role="radio"
                title={f.title}
                aria-checked={placement.facing === f.value}
                className={placement.facing === f.value ? 'active' : ''}
                onClick={() => setCombatOrder({ facing: f.value })}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="check" title="A second row along the opposite edge, facing its own side the same way">
            <input type="checkbox" checked={placement.both} onChange={(e) => setCombatOrder({ both: e.target.checked })} />
            Also along the opposite edge
          </label>
          <label className="check" title="A faint ring on the table where the acting combatant's token started its turn">
            <input
              type="checkbox"
              checked={combat.showStart !== false}
              onChange={(e) => setCombatOrder({ showStart: e.target.checked })}
            />
            Show where the turn started
          </label>
        </>
      )}
    </Section>
  )
}
