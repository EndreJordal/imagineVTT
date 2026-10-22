import {
  BrickWall,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudFog,
  DoorOpen,
  Ellipsis,
  Eye,
  EyeOff,
  FilePlus,
  Film,
  Flame,
  Flashlight,
  Folder,
  FolderOpen,
  Grid3x3,
  Hand,
  Images,
  Lightbulb,
  Lock,
  LockOpen,
  Magnet,
  MousePointer2,
  Moon,
  MoveHorizontal,
  MoveVertical,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCcwSquare,
  RotateCwSquare,
  Save,
  ScanEye,
  Settings,
  Square,
  ShieldCheck,
  Sun,
  Theater,
  Tv,
  Undo2,
  UserRound,
  Volume2,
  WandSparkles,
  X,
  type LucideIcon,
  Megaphone,
  Waves,
  Slash,
  Circle,
  Spline,
} from 'lucide-react'
import type { LightIcon } from '../shared/lights'

/**
 * The app's icons (Lucide, ISC licence): one outline style, drawn in the text colour, so
 * they're grey normally and take the accent colour on active buttons.
 */
const ICONS = {
  'new': FilePlus,
  open: FolderOpen,
  save: Save,
  undo: Undo2,
  redo: Redo2,
  day: Sun,
  night: Moon,
  peek: ScanEye,
  fog: CloudFog,
  'reset-fog': RotateCcw,
  safety: ShieldCheck,
  settings: Settings,
  table: Tv,
  select: MousePointer2,
  walls: BrickWall,
  doors: DoorOpen,
  lights: Lightbulb,
  snap: Magnet,
  'auto-walls': WandSparkles,
  locked: Lock,
  unlocked: LockOpen,
  'detect-grid': Grid3x3,
  'fit-width': MoveHorizontal,
  'fit-height': MoveVertical,
  folder: Folder,
  close: X,
  'hand-held': Hand,
  animated: Film,
  add: Plus,
  more: Ellipsis,
  'chevron-down': ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  'turn-left': RotateCcwSquare,
  hide: EyeOff,
  'turn-right': RotateCwSquare,
  curtain: Theater,
  slideshow: Images,
  sound: Volume2,
  play: Play,
  stop: Square,
  alert: Megaphone,
  water: Waves,
  measure: Slash,
  'measure-line': Slash,
  'measure-circle': Circle,
  'measure-free': Spline,
  character: UserRound,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

/** Light kinds share a few icons: the token's ring colour tells them apart. */
const LIGHT_ICONS: Record<LightIcon, LucideIcon> = {
  lamp: Lightbulb,
  fire: Flame,
  flashlight: Flashlight,
  eye: Eye,
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const Component = ICONS[name]
  return <Component size={size} strokeWidth={2} className={`icon${className ? ` ${className}` : ''}`} aria-hidden />
}

export function LightKindIcon({ icon, size = 16 }: { icon: LightIcon; size?: number }) {
  const Component = LIGHT_ICONS[icon]
  return <Component size={size} strokeWidth={2} className="icon" aria-hidden />
}
