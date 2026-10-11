import { describe, expect, it } from 'vitest'
import { readNrbf, type NrbfObject } from './nrbf'

/** Builds a little MS-NRBF stream by hand. */
class Stream {
  bytes: number[] = []
  u8(v: number) {
    this.bytes.push(v & 255)
    return this
  }
  i32(v: number) {
    for (let i = 0; i < 4; i++) this.bytes.push((v >> (8 * i)) & 255)
    return this
  }
  f32(v: number) {
    const b = new Uint8Array(new Float32Array([v]).buffer)
    this.bytes.push(...b)
    return this
  }
  str(s: string) {
    const b = new TextEncoder().encode(s)
    return this.u8(b.length).raw(b)
  }
  raw(b: ArrayLike<number>) {
    this.bytes.push(...Array.from(b))
    return this
  }
  done() {
    return new Uint8Array(this.bytes)
  }
}

describe('readNrbf', () => {
  it('reads classes with typed members, strings, byte arrays, lists and references', () => {
    const s = new Stream()
    s.u8(0).i32(1).i32(-1).i32(1).i32(0) // header: root object 1
    s.u8(12).i32(2).str('Assembly-CSharp') // library 2
    // class 1 "Tile" { _name: string, _scale: float, _image: byte[], _again: byte[] (ref), _tags: object }
    s.u8(5).i32(1).str('Tile').i32(5).str('_name').str('_scale').str('_image').str('_again').str('_tags')
    s.raw([1, 0, 7, 7, 2]) // types: String, Primitive, PrimitiveArray, PrimitiveArray, Object
    s.u8(11) // _scale: Single
    s.u8(2) // _image: Byte[]
    s.u8(2) // _again: Byte[]
    s.i32(2) // library id
    s.u8(6).i32(3).str('Crown') // _name
    s.f32(0.5) // _scale, inline
    s.u8(15).i32(4).i32(3).u8(2).raw([0x89, 0x50, 0x4e]) // _image: byte array [3]
    s.u8(9).i32(4) // _again: reference to the same array
    s.u8(16).i32(5).i32(3) // _tags: object array of 3
    s.u8(6).i32(6).str('gold')
    s.u8(13).u8(2) // two nulls
    s.u8(11) // end
    const v = readNrbf(s.done()) as NrbfObject
    expect(v.$class).toBe('Tile')
    expect(v._name).toBe('Crown')
    expect(v._scale).toBeCloseTo(0.5)
    expect([...(v._image as Uint8Array)]).toEqual([0x89, 0x50, 0x4e])
    expect(v._again).toBe(v._image)
    expect(v._tags).toEqual(['gold', null, null])
  })

  it('reuses class metadata for later objects of the same class (ClassWithId)', () => {
    const s = new Stream()
    s.u8(0).i32(1).i32(-1).i32(1).i32(0)
    // root: class "Pair" { a: object, b: object }
    s.u8(4).i32(1).str('Pair').i32(2).str('a').str('b').raw([2, 2])
    // a: class "Point" { x: Int32 }
    s.u8(4).i32(2).str('Point').i32(1).str('x').u8(0).u8(8).i32(7)
    // b: another Point, by metadata id 2
    s.u8(1).i32(3).i32(2).i32(9)
    s.u8(11)
    const v = readNrbf(s.done()) as NrbfObject
    expect(v.a).toEqual({ $class: 'Point', x: 7 })
    expect(v.b).toEqual({ $class: 'Point', x: 9 })
  })

  it('rejects data that is not a .NET binary stream', () => {
    expect(() => readNrbf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/not a .NET binary stream/)
  })
})
