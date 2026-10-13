import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_DOOR_SOUNDS, type DoorSounds, type SoundTrigger } from '../shared/sound'
import { loadSound, useAssets } from './assetLibrary'
import { allowOutputNames, audioOutputs, player } from './audio'
import { Icon } from './icons'
import { playGlobalSound, playMapSound } from './soundController'
import { useGm } from './store'
import { Slider, Switch } from './ui'
import { useDropdown } from './useDropdown'

const TRIGGERS: { value: SoundTrigger; label: string; title: string }[] = [
  { value: 'manual', label: 'Manual', title: 'Plays when you press play' },
  {
    value: 'enter',
    label: 'On entering',
    title: 'Plays once when a vision token comes into range',
  },
  {
    value: 'both',
    label: 'Both',
    title: 'Plays on entering, and when you press play',
  },
]

/** Floating panel for the selected sound on the map. */
export function SoundPanel() {
  const sound = useGm((s) => s.scene.sounds?.find((x) => x.id === s.selectedSoundId))
  if (!sound) return null
  const { selectSound, updateSound, removeSound, makeGlobal } = useGm.getState()
  const playing = sound.loop && sound.enabled

  return (
    <aside className="light-panel" aria-label="Sound">
      <header>
        <span className="light-panel-title">
          <Icon name="sound" /> {sound.name}
        </span>
        <button className="icon-button" title="Close" onClick={() => selectSound(null)}>
          <Icon name="close" />
        </button>
      </header>
      <Switch
        left="Disabled"
        right="Enabled"
        on={sound.enabled}
        title="Disabled, it's kept on the map but never plays"
        onChange={(enabled) => updateSound(sound.id, { enabled })}
      />
      <button
        onClick={() => playMapSound(sound.id)}
        title={sound.loop ? 'Start or stop the loop' : 'Play it now, at full volume'}
      >
        <Icon name={playing ? 'stop' : 'play'} /> {sound.loop ? (playing ? 'Stop' : 'Play loop') : 'Play now'}
      </button>
      <Slider
        label="Volume"
        unit="%"
        scale={100}
        value={sound.volume}
        fallback={0.8}
        min={0}
        max={1}
        step={0.01}
        onChange={(volume) => updateSound(sound.id, { volume })}
      />
      <Slider
        label="Range"
        unit="sq"
        value={sound.range}
        fallback={6}
        min={1}
        max={40}
        step={0.5}
        title="How far from it a vision token hears it: louder the closer it gets"
        onChange={(range) => updateSound(sound.id, { range })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={sound.loop}
          onChange={(e) => updateSound(sound.id, { loop: e.target.checked })}
        />
        Loop
      </label>
      {sound.loop ? (
        <p className="hint">Plays while enabled, louder as the party comes near.</p>
      ) : (
        <>
          <span className="slider-label">Plays</span>
          <div className="segmented" role="radiogroup" aria-label="Plays">
            {TRIGGERS.map((t) => (
              <button
                key={t.value}
                role="radio"
                title={t.title}
                aria-checked={sound.trigger === t.value}
                className={sound.trigger === t.value ? 'active' : ''}
                onClick={() => updateSound(sound.id, { trigger: t.value, spent: false })}
              >
                {t.label}
              </button>
            ))}
          </div>
          {sound.trigger !== 'manual' &&
            (sound.spent ? (
              <button
                title="Let it play again the next time the party comes into range"
                onClick={() => updateSound(sound.id, { spent: false })}
              >
                Re-arm
              </button>
            ) : (
              <p className="hint">Plays once, the first time a vision token comes into range.</p>
            ))}
        </>
      )}
      <button
        title="Off the map, into the Sound mixer in the toolbar: heard everywhere"
        onClick={() => makeGlobal(sound.id)}
      >
        Make global
      </button>
      <button onClick={() => removeSound(sound.id)}>Remove</button>
    </aside>
  )
}

/** Toolbar Sound button: the mixer, a fader per global sound and the master on the right. */
export function SoundMixer() {
  const { open, setOpen, root } = useDropdown()
  const globals = useGm((s) => s.scene.globalSounds) ?? []
  const master = useGm((s) => s.masterVolume)
  const { updateGlobal, removeGlobal, setMasterVolume } = useGm.getState()
  const playing = globals.some((g) => g.loop && g.playing)
  return (
    <div className="menu" ref={root}>
      <button
        className={`toolbar-item${playing ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Sound: the scene's global sounds, and the master volume"
        onClick={() => setOpen(!open)}
      >
        <Icon name="sound" /> Sound
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="menu-list menu-right settings-panel mixer-panel" role="dialog" aria-label="Sound mixer">
          <div className="mixer">
            {globals.map((g) => (
              <div className="mixer-channel" key={g.id}>
                <span className="mixer-name" title={g.name}>
                  {g.name}
                </span>
                <Fader label={g.name} value={g.volume} onChange={(volume) => updateGlobal(g.id, { volume })} />
                <button
                  className={`icon-button${g.loop && g.playing ? ' active' : ''}`}
                  title={g.loop ? (g.playing ? 'Stop' : 'Play (loops)') : 'Play'}
                  onClick={() => playGlobalSound(g.id)}
                >
                  <Icon name={g.loop && g.playing ? 'stop' : 'play'} />
                </button>
                <label className="check" title="Loop">
                  <input
                    type="checkbox"
                    checked={g.loop}
                    onChange={(e) =>
                      updateGlobal(g.id, {
                        loop: e.target.checked,
                        playing: false,
                      })
                    }
                  />
                  Loop
                </label>
                <button className="icon-button" title="Remove" onClick={() => removeGlobal(g.id)}>
                  <Icon name="close" />
                </button>
              </div>
            ))}
            {!globals.length && (
              <p className="hint mixer-empty">
                No global sounds yet. Drop a sound on the map, then press Make global in its panel.
              </p>
            )}
            <div className="mixer-channel mixer-master">
              <span className="mixer-name">Master</span>
              <Fader label="Master" value={master} onChange={setMasterVolume} />
              <span className="hint">{Math.round(master * 100)}%</span>
            </div>
          </div>
          {player.blocked && <p className="hint">Click anywhere in this window to let sound play.</p>}
          <p className="hint">Global sounds belong to the scene: they stop when another scene is opened.</p>
        </div>
      )}
    </div>
  )
}

function Fader({ label, value, onChange }: { label: string; value: number; onChange(v: number): void }) {
  return (
    <input
      type="range"
      className="fader"
      aria-label={`${label} volume`}
      aria-orientation="vertical"
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      onDoubleClick={() => onChange(0.8)}
    />
  )
}

/** Settings: where the game's sound plays. */
export function SoundOutput() {
  const output = useGm((s) => s.audioOutput)
  const [outputs, setOutputs] = useState<{ id: string; label: string }[]>([])
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    let live = true
    void audioOutputs().then((o) => live && setOutputs(o))
    return () => {
      live = false
    }
  }, [asked])
  const unnamed = outputs.some((o) => o.label.startsWith('Output '))
  if (!player.canChooseOutput) return <p className="hint">This browser plays sound through the system’s output only.</p>
  return (
    <>
      <select
        value={output}
        aria-label="Sound output"
        onChange={(e) => useGm.getState().setAudioOutput(e.target.value)}
      >
        <option value="">System default</option>
        {outputs
          .filter((o) => o.id)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
      </select>
      {unnamed && (
        <button
          title="The browser names the outputs once it's allowed the microphone (nothing is recorded)"
          onClick={() => void allowOutputNames().then(() => setAsked((n) => n + 1))}
        >
          Show device names
        </button>
      )}
      <button onClick={() => player.testTone()}>
        <Icon name="play" /> Test sound
      </button>
      <p className="hint">Game sound (map, mixer and doors) plays here. Library previews play on this computer.</p>
    </>
  )
}

/** The most matches a search lists (it narrows as you type). */
const MAX_RESULTS = 100

/** Pick a library sound (searchable), or none. */
export function SoundPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange(path: string | null): void
}) {
  const assets = useAssets((s) => s.assets)
  const clips = useGm((s) => s.soundClips)
  const [query, setQuery] = useState('')
  const sounds = useMemo(() => assets.filter((a) => a.kind === 'Sounds'), [assets])
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return sounds.filter((a) => words.every((w) => `${a.name} ${a.category}`.toLowerCase().includes(w))).slice(0, MAX_RESULTS)
  }, [sounds, query])
  const name = value ? (clips[value]?.name ?? sounds.find((a) => a.path === value)?.name ?? 'missing sound') : 'None'
  return (
    <div className="sound-picker">
      <div className="row">
        <span className="slider-label">{label}</span>
        <span className="sound-picker-name" title={name}>
          {name}
        </span>
        {value && (
          <>
            <button className="icon-button" title="Listen" onClick={() => void player.previewSound(clips, value)}>
              <Icon name="play" />
            </button>
            <button className="icon-button" title="No sound" onClick={() => onChange(null)}>
              <Icon name="close" />
            </button>
          </>
        )}
      </div>
      {sounds.length > 0 ? (
        <input type="search" placeholder="Search sounds…" value={query} onChange={(e) => setQuery(e.target.value)} />
      ) : (
        !value && <p className="hint">Connect the asset folder (Assets) to pick sounds.</p>
      )}
      {results.length > 0 && (
        // Many matches scroll in their own box, so the panel doesn't outgrow the window.
        <div className="sound-picker-results">
          {results.map((a) => (
            <button
              key={a.path}
              className="sound-row"
              onClick={() =>
                void loadSound(a.path).then((ok) => {
                  if (!ok) return
                  onChange(a.path)
                  setQuery('')
                })
              }
            >
              {a.name} <span className="hint">{a.category}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Door sounds: opening and closing, and how loud. */
export function DoorSoundsPicker({ value, onChange }: { value: DoorSounds; onChange(v: DoorSounds): void }) {
  return (
    <>
      <SoundPicker label="Opening" value={value.open} onChange={(open) => onChange({ ...value, open })} />
      <SoundPicker label="Closing" value={value.close} onChange={(close) => onChange({ ...value, close })} />
      <Slider
        label="Volume"
        unit="%"
        scale={100}
        value={value.volume}
        fallback={DEFAULT_DOOR_SOUNDS.volume}
        min={0}
        max={1}
        step={0.01}
        onChange={(volume) => onChange({ ...value, volume })}
      />
    </>
  )
}
