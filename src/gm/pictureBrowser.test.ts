import { describe, expect, it } from 'vitest'
import { browse } from './pictureBrowser'

const pic = (id: string) => ({ id, name: id.split('/').pop()!, file: new File([], id) })

describe('browsing a picture folder', () => {
  const images = ['top.png', 'NYC/Streets/corner.png', 'NYC/Streets/alley.png', 'NYC/bodega.png', 'Crypts/vault.png'].map(pic)

  it('shows the subfolders (with how many pictures each holds) and the pictures right here', () => {
    const top = browse(images, '')
    expect(top.folders).toEqual([
      { name: 'Crypts', path: 'Crypts/', count: 1 },
      { name: 'NYC', path: 'NYC/', count: 3 },
    ])
    expect(top.here.map((i) => i.id)).toEqual(['top.png'])
    const nyc = browse(images, 'NYC/')
    expect(nyc.folders).toEqual([{ name: 'Streets', path: 'NYC/Streets/', count: 2 }])
    expect(nyc.here.map((i) => i.id)).toEqual(['NYC/bodega.png'])
    expect(browse(images, 'NYC/Streets/').here).toHaveLength(2)
  })
})
