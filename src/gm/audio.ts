import type { SoundClip, SoundClips } from '../shared/sound'

/**
 * Plays the game's sound, in the GM's window (browsers only let audio start after a click in
 * the page, and the GM's window is the one being clicked), to the output the GM picks: the
 * TV's speakers, say. Library previews play on a second, default output (the GM's own).
 */

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

/** A sound playing once: `done` when it has finished (or been stopped). */
export interface OnceHandle {
  done: boolean
  stop(): void
}

/** A sound that keeps playing: a loop, or an ambience's layers. */
export interface LoopHandle {
  setVolume(volume: number): void
  stop(): void
}

class Player {
  private ctx: SinkContext | null = null
  private master: GainNode | null = null
  private preview: AudioContext | null = null
  private previewing: AudioBufferSourceNode | null = null
  private buffers = new WeakMap<Blob, Promise<AudioBuffer>>()
  private masterVolume = 0.8
  private output = ''

  /** The game's context, made on first use (and resumed: the page has been clicked by then). */
  private game() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' }) as SinkContext
      this.master = this.ctx.createGain()
      this.master.gain.value = this.masterVolume
      this.master.connect(this.ctx.destination)
      if (this.output) void this.ctx.setSinkId?.(this.output).catch(() => {})
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return { ctx: this.ctx, master: this.master! }
  }

  /** Let sound start (call from a click or key press). */
  wake() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
  }

  /** Whether sound is held back until the page is clicked. */
  get blocked() {
    return this.ctx?.state === 'suspended'
  }

  setMaster(volume: number) {
    this.masterVolume = volume
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05)
  }

  /** The output device ('' for the default). Not every browser can choose. */
  async setOutput(id: string) {
    this.output = id
    if (this.ctx?.setSinkId) await this.ctx.setSinkId(id).catch(() => {})
  }

  get canChooseOutput() {
    return 'setSinkId' in AudioContext.prototype
  }

  private decode(blob: Blob, ctx: BaseAudioContext): Promise<AudioBuffer> {
    let p = this.buffers.get(blob)
    if (!p) {
      p = blob.arrayBuffer().then((b) => ctx.decodeAudioData(b))
      this.buffers.set(blob, p)
      p.catch(() => this.buffers.delete(blob))
    }
    return p
  }

  /** One of a clip's takes, decoded. */
  private async take(clip: SoundClip, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    if (!clip.takes.length) return null
    return this.decode(clip.takes[Math.floor(Math.random() * clip.takes.length)], ctx)
  }

  /** Play a clip once (an ambience: its layers once); the handle cuts it short. */
  playOnce(clips: SoundClips, key: string, volume: number): OnceHandle {
    const { ctx, master } = this.game()
    const gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(master)
    const sources = new Set<AudioBufferSourceNode>()
    let stopped = false
    const handle: OnceHandle = {
      done: false,
      stop: () => {
        if (stopped) return
        stopped = true
        handle.done = true
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02)
        window.setTimeout(() => {
          for (const s of sources) s.stop()
          gain.disconnect()
        }, 150)
      },
    }
    const play = async (k: string, v: number) => {
      const clip = clips[k]
      if (!clip || stopped) return
      if (clip.layers) {
        await Promise.all(clip.layers.map((l) => play(l.clip, v * l.volume * 2)))
        return
      }
      const buffer = await this.take(clip, ctx)
      if (!buffer || stopped) return
      const layer = ctx.createGain()
      layer.gain.value = v
      layer.connect(gain)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(layer)
      sources.add(source)
      source.onended = () => {
        sources.delete(source)
        layer.disconnect()
        if (!sources.size && !stopped) {
          handle.done = true
          gain.disconnect()
        }
      }
      source.start()
    }
    void play(key, 1).then(() => {
      if (!sources.size && !stopped) handle.done = true
    })
    return handle
  }

  /** Keep a clip playing (an ambience: its loops looping, the rest repeating now and then). */
  loop(clips: SoundClips, key: string, volume: number): LoopHandle {
    const { ctx, master } = this.game()
    const gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(master)
    const sources: AudioBufferSourceNode[] = []
    const timers: number[] = []
    let stopped = false
    const start = async (k: string, layerVolume: number, every: number) => {
      const clip = clips[k]
      if (!clip || stopped) return
      const buffer = await this.take(clip, ctx)
      if (!buffer || stopped) return
      const layer = ctx.createGain()
      layer.gain.value = layerVolume
      layer.connect(gain)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(layer)
      if (every <= 0) {
        source.loop = true
        sources.push(source)
      } else {
        source.onended = () => layer.disconnect()
        // Again in about `every` seconds (varied, so it doesn't tick like a clock).
        timers.push(window.setTimeout(() => void start(k, layerVolume, every), every * (0.6 + Math.random() * 0.8) * 1000))
      }
      source.start()
    }
    const clip = clips[key]
    if (clip?.layers) {
      // Ambience volumes are set low in Arkenforge's presets: doubled, they sit like single sounds.
      for (const l of clip.layers) {
        if (l.every > 0) {
          timers.push(window.setTimeout(() => void start(l.clip, l.volume * 2, l.every), Math.random() * l.every * 1000))
        } else void start(l.clip, l.volume * 2, 0)
      }
    } else void start(key, 1, 0)
    return {
      setVolume: (v) => gain.gain.setTargetAtTime(v, ctx.currentTime, 0.1),
      stop: () => {
        stopped = true
        for (const t of timers) clearTimeout(t)
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1)
        window.setTimeout(() => {
          for (const s of sources) s.stop()
          gain.disconnect()
        }, 500)
      },
    }
  }

  /** A short tone through the game's output, to check where it comes out. */
  testTone() {
    const { ctx, master } = this.game()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 660
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(gain).connect(master)
    osc.onended = () => gain.disconnect()
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  }

  /** Preview a library sound on the GM's own output (another preview stops it). */
  async previewSound(clips: SoundClips, key: string, ended?: () => void) {
    this.stopPreview()
    this.preview ??= new AudioContext()
    if (this.preview.state === 'suspended') await this.preview.resume()
    const clip = clips[key]
    // An ambience: its first looping layer gives the idea.
    const k = clip?.layers ? (clip.layers.find((l) => l.every <= 0) ?? clip.layers[0])?.clip : key
    const target = k && clips[k]
    if (!target) return
    const buffer = await this.take(target, this.preview)
    if (!buffer) return
    const source = this.preview.createBufferSource()
    source.buffer = buffer
    source.connect(this.preview.destination)
    source.onended = () => {
      if (this.previewing === source) this.previewing = null
      ended?.()
    }
    source.start()
    this.previewing = source
  }

  stopPreview() {
    this.previewing?.stop()
    this.previewing = null
  }
}

export const player = new Player()

/** The audio outputs the browser offers (names only once it's been allowed the microphone). */
export async function audioOutputs(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => [])
  return (devices ?? [])
    .filter((d) => d.kind === 'audiooutput')
    .map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || `Output ${i + 1}` }))
}

/** Ask once for the microphone, which is what lets the browser name the outputs. */
export async function allowOutputNames(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const t of stream.getTracks()) t.stop()
    return true
  } catch {
    return false
  }
}
