import { describe, expect, it } from 'vitest'
import { hitsMeasure, measureLabel, snapMeasure, type Measure } from './measure'

const grid = { size: 100, offsetX: 0, offsetY: 0, visible: true, color: '#000000', opacity: 1 }
const line = (distance: Measure['distance']): Measure => ({
  id: 'm',
  shape: 'line',
  points: [{ x: 50, y: 50 }, { x: 350, y: 250 }],
  color: '#ff0000',
  distance,
})

describe('measuring', () => {
  it('snaps to square centres or grid corners', () => {
    expect(snapMeasure({ x: 130, y: 280 }, grid, 'center')).toEqual({ x: 150, y: 250 })
    expect(snapMeasure({ x: 130, y: 280 }, grid, 'line')).toEqual({ x: 100, y: 300 })
  })

  it('counts diagonals as 1 for grid traverse, and the straight line for real distance', () => {
    expect(measureLabel(line('grid'), 100)).toBe('Movement: 3 yd')
    expect(measureLabel(line('real'), 100)).toBe('Distance: 3.6 yd')
    // A circle's radius is always the real distance.
    expect(measureLabel({ ...line('grid'), shape: 'circle' }, 100)).toBe('Radius: 3.6 yd')
    expect(measureLabel({ ...line('real'), shape: 'free' }, 100)).toBeNull()
  })

  it('finds a measurement under the pointer', () => {
    expect(hitsMeasure(line('grid'), { x: 200, y: 150 }, 5)).toBe(true)
    expect(hitsMeasure(line('grid'), { x: 200, y: 50 }, 5)).toBe(false)
    const circle: Measure = { ...line('grid'), shape: 'circle', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }
    expect(hitsMeasure(circle, { x: 0, y: 300 }, 5)).toBe(true)
    expect(hitsMeasure(circle, { x: 0, y: 150 }, 5)).toBe(false)
  })
})
