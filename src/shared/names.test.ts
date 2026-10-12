import { describe, expect, it } from 'vitest'
import { baseName, nextName } from './names'

describe('names', () => {
  it('numbers from 1, after the highest taken', () => {
    expect(nextName('Torch', [])).toBe('Torch 1')
    expect(nextName('Torch', ['Torch 1', 'Torch 4', 'Candle 9'])).toBe('Torch 5')
  })

  it("names an asset's first after it, then numbers its copies from 2", () => {
    expect(nextName('Crate', [], true)).toBe('Crate')
    expect(nextName('Crate', ['Crate'], true)).toBe('Crate 2')
    expect(nextName('Crate', ['Crate', 'Crate 2'], true)).toBe('Crate 3')
    expect(baseName('Crate 12')).toBe('Crate')
    expect(baseName('Crate')).toBe('Crate')
  })
})
