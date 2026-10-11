/** Number helpers for the GM panels' inputs. */

export function round(n: number, digits: number) {
  return Math.round(n * 10 ** digits) / 10 ** digits
}

export function positive(n: number, set: (n: number) => void) {
  if (Number.isFinite(n) && n > 0) set(n)
}

export function finite(n: number, set: (n: number) => void) {
  if (Number.isFinite(n)) set(n)
}
