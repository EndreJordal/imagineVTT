/**
 * The left sidebar's layout (the GM's own, kept per browser): which sections are folded,
 * and Prep or Play, each showing the sections the GM chose for it.
 */
import { create } from 'zustand'

/** The sidebar's sections, by id (the id stays when a section's title shows more). */
export const SIDEBAR_SECTIONS = [
  { id: 'pvb', label: 'Player View Box (PVB)' },
  { id: 'curtain', label: 'Curtain' },
  { id: 'handouts', label: 'Show to players' },
  { id: 'combat', label: 'Combat' },
  { id: 'characters', label: 'Character tokens' },
  { id: 'measuring', label: 'Measuring' },
  { id: 'map', label: 'Map' },
  { id: 'grid', label: 'Grid' },
  { id: 'doors', label: 'Doors' },
  { id: 'assets', label: 'Assets' },
] as const

export type SectionId = (typeof SIDEBAR_SECTIONS)[number]['id']
export type SidebarMode = 'prep' | 'play'

interface SidebarLayout {
  collapsed: SectionId[]
  mode: SidebarMode
  /** The sections each mode shows. */
  shown: Record<SidebarMode, SectionId[]>
}

const ALL = SIDEBAR_SECTIONS.map((s) => s.id)
const DEFAULT: SidebarLayout = {
  collapsed: [],
  mode: 'prep',
  shown: { prep: ALL, play: ['combat', 'characters', 'curtain', 'handouts', 'measuring', 'map'] },
}

const KEY = 'imaginevtt.sidebar'

function load(): SidebarLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (saved && typeof saved === 'object') return { ...DEFAULT, ...saved, shown: { ...DEFAULT.shown, ...saved.shown } }
    // Folds remembered before the layout was kept here (by title).
    const old = JSON.parse(localStorage.getItem('imaginevtt.collapsedSections') ?? '[]')
    if (Array.isArray(old)) {
      const collapsed = SIDEBAR_SECTIONS.filter((s) => old.some((t) => typeof t === 'string' && t.startsWith(s.label))).map((s) => s.id)
      return { ...DEFAULT, collapsed }
    }
  } catch {
    // Storage unavailable or damaged: the default layout.
  }
  return DEFAULT
}

interface SidebarStore extends SidebarLayout {
  toggleCollapsed(id: SectionId): void
  collapseAll(collapsed: boolean): void
  setMode(mode: SidebarMode): void
  /** Show a section in a mode, or not. */
  setShown(mode: SidebarMode, id: SectionId, on: boolean): void
}

export const useSidebar = create<SidebarStore>()((set, get) => ({
  ...load(),
  toggleCollapsed: (id) =>
    set((s) => ({ collapsed: s.collapsed.includes(id) ? s.collapsed.filter((x) => x !== id) : [...s.collapsed, id] })),
  // Folds (or opens) the sections the current mode shows.
  collapseAll: (collapsed) => {
    const { shown, mode } = get()
    set((s) => ({
      collapsed: collapsed ? [...new Set([...s.collapsed, ...shown[mode]])] : s.collapsed.filter((x) => !shown[mode].includes(x)),
    }))
  },
  setMode: (mode) => set({ mode }),
  setShown: (mode, id, on) =>
    set((s) => ({
      shown: { ...s.shown, [mode]: on ? ALL.filter((x) => x === id || s.shown[mode].includes(x)) : s.shown[mode].filter((x) => x !== id) },
    })),
}))

useSidebar.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ collapsed: s.collapsed, mode: s.mode, shown: s.shown }))
  } catch {
    // Not remembered, that's all.
  }
})
