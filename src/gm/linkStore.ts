import { create } from 'zustand'
import { readCombatLink, type CombatLink } from '../shared/combat'

/** A combat link waiting for the GM's choice (the banner). */
export const usePendingLink = create<{ link: CombatLink | null; seq: number }>()(() => ({ link: null, seq: 0 }))

/** Take a `#combat=` link from an address hash (and clear it from the address bar). */
export function takeLink(hash: string, fromAddressBar: boolean): boolean {
  const link = readCombatLink(hash)
  if (!link) return false
  usePendingLink.setState((s) => ({ link, seq: s.seq + 1 }))
  if (fromAddressBar) {
    try {
      history.replaceState(null, '', location.pathname + location.search)
    } catch {
      location.hash = ''
    }
  }
  return true
}
