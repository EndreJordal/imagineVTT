import { useLayoutEffect, useRef } from 'react'

/**
 * A grid of pictures that scrolls after `rows` rows (none: never): the box it's put on is
 * as tall as that many rows of thumbnails.
 */
export function useRowsBox(rows: number | undefined, count: number) {
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = list.current
    if (!box || !rows) return
    const fit = () => {
      const first = box.firstElementChild as HTMLElement | null
      const gap = parseFloat(getComputedStyle(box).rowGap) || 0
      box.style.maxHeight = first ? `${rows * first.offsetHeight + (rows - 1) * gap}px` : ''
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(box)
    return () => watch.disconnect()
  }, [rows, count])
  return list
}
