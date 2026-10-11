/**
 * A reader for .NET BinaryFormatter data (MS-NRBF), the format Arkenforge saves its assets
 * in. Turns a stream into plain values: objects of class records (with `$class`), arrays,
 * strings, numbers, booleans, null, and Uint8Array for byte arrays (where images live).
 * References between records are resolved. Only reading; no method calls (unused here).
 */

export interface NrbfObject {
  $class: string
  [field: string]: NrbfValue
}

export type NrbfValue = null | boolean | number | bigint | string | Uint8Array | NrbfValue[] | NrbfObject

/** Record types. */
const Rec = {
  Header: 0,
  ClassWithId: 1,
  SystemClassWithMembers: 2,
  ClassWithMembers: 3,
  SystemClassWithMembersAndTypes: 4,
  ClassWithMembersAndTypes: 5,
  ObjectString: 6,
  BinaryArray: 7,
  MemberPrimitiveTyped: 8,
  MemberReference: 9,
  ObjectNull: 10,
  MessageEnd: 11,
  Library: 12,
  NullMultiple256: 13,
  NullMultiple: 14,
  ArraySinglePrimitive: 15,
  ArraySingleObject: 16,
  ArraySingleString: 17,
} as const

/** Member value kinds. */
const Bin = {
  Primitive: 0,
  String: 1,
  Object: 2,
  SystemClass: 3,
  Class: 4,
  ObjectArray: 5,
  StringArray: 6,
  PrimitiveArray: 7,
} as const

interface ClassMeta {
  name: string
  members: string[]
  types: number[] | null
  /** Per member: the primitive type, for primitive members. */
  primitives: (number | null)[]
}

/** A placeholder for a reference to a record not read yet. */
class Ref {
  readonly id: number
  constructor(id: number) {
    this.id = id
  }
}

/** Null run inside an array: this many nulls. */
class Nulls {
  readonly count: number
  constructor(count: number) {
    this.count = count
  }
}

export class NrbfError extends Error {}

export function readNrbf(bytes: Uint8Array): NrbfValue {
  return new Reader(bytes).read()
}

class Reader {
  private view: DataView
  private pos = 0
  private bytes: Uint8Array
  private objects = new Map<number, NrbfValue>()
  private metas = new Map<number, ClassMeta>()
  private decoder = new TextDecoder()

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  read(): NrbfValue {
    if (this.u8() !== Rec.Header) throw new NrbfError('not a .NET binary stream')
    const rootId = this.i32()
    this.pos += 12 // header id, major and minor version
    for (;;) {
      const v = this.record()
      if (v === END) break
    }
    return this.resolve(this.objects.get(rootId) ?? null, new Set())
  }

  // Replace Ref placeholders with their objects (in place; cycles are left as they are).
  private resolve(v: unknown, seen: Set<unknown>): NrbfValue {
    if (v instanceof Ref) return this.resolve(this.objects.get(v.id) ?? null, seen)
    if (v === null || typeof v !== 'object' || v instanceof Uint8Array || seen.has(v)) return v as NrbfValue
    seen.add(v)
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = this.resolve(v[i], seen)
    } else {
      const o = v as Record<string, unknown>
      for (const k of Object.keys(o)) o[k] = this.resolve(o[k], seen)
    }
    return v as NrbfValue
  }

  private u8() {
    return this.view.getUint8(this.pos++)
  }
  private i32() {
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  private string() {
    let len = 0
    let shift = 0
    for (;;) {
      const b = this.u8()
      len |= (b & 0x7f) << shift
      if (!(b & 0x80)) break
      shift += 7
    }
    const s = this.decoder.decode(this.bytes.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }

  private primitive(type: number): NrbfValue {
    const v = this.view
    const p = this.pos
    switch (type) {
      case 1: this.pos += 1; return v.getUint8(p) !== 0 // Boolean
      case 2: this.pos += 1; return v.getUint8(p) // Byte
      case 3: { // Char: one UTF-8 character
        const b = v.getUint8(p)
        const n = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4
        this.pos += n
        return this.decoder.decode(this.bytes.subarray(p, p + n))
      }
      case 5: return this.string() // Decimal, as text
      case 6: this.pos += 8; return v.getFloat64(p, true)
      case 7: this.pos += 2; return v.getInt16(p, true)
      case 8: this.pos += 4; return v.getInt32(p, true)
      case 9: case 12: case 13: this.pos += 8; return v.getBigInt64(p, true) // Int64, TimeSpan, DateTime
      case 10: this.pos += 1; return v.getInt8(p)
      case 11: this.pos += 4; return v.getFloat32(p, true)
      case 14: this.pos += 2; return v.getUint16(p, true)
      case 15: this.pos += 4; return v.getUint32(p, true)
      case 16: this.pos += 8; return v.getBigUint64(p, true)
      case 17: return null
      case 18: return this.string()
      default: throw new NrbfError(`unknown primitive type ${type} at ${p}`)
    }
  }

  /** Reads one record; returns its value (or END / a Nulls run / a Ref). */
  private record(): unknown {
    const at = this.pos
    const type = this.u8()
    switch (type) {
      case Rec.Library:
        this.i32()
        this.string()
        return this.record() // a library record precedes the record that uses it
      case Rec.MessageEnd:
        return END
      case Rec.ObjectNull:
        return null
      case Rec.NullMultiple256:
        return new Nulls(this.u8())
      case Rec.NullMultiple:
        return new Nulls(this.i32())
      case Rec.MemberReference:
        return new Ref(this.i32())
      case Rec.ObjectString: {
        const id = this.i32()
        const s = this.string()
        this.objects.set(id, s)
        return s
      }
      case Rec.MemberPrimitiveTyped:
        return this.primitive(this.u8())
      case Rec.ClassWithMembersAndTypes:
      case Rec.SystemClassWithMembersAndTypes:
      case Rec.ClassWithMembers:
      case Rec.SystemClassWithMembers: {
        const id = this.i32()
        const name = this.string()
        const count = this.i32()
        const members = Array.from({ length: count }, () => this.string())
        let types: number[] | null = null
        const primitives: (number | null)[] = members.map(() => null)
        if (type === Rec.ClassWithMembersAndTypes || type === Rec.SystemClassWithMembersAndTypes) {
          types = members.map(() => this.u8())
          types.forEach((t, i) => {
            if (t === Bin.Primitive || t === Bin.PrimitiveArray) primitives[i] = this.u8()
            else if (t === Bin.SystemClass) this.string()
            else if (t === Bin.Class) {
              this.string()
              this.i32()
            }
          })
        }
        if (type === Rec.ClassWithMembersAndTypes || type === Rec.ClassWithMembers) this.i32() // library id
        const meta: ClassMeta = { name, members, types, primitives }
        this.metas.set(id, meta)
        return this.classValues(id, meta)
      }
      case Rec.ClassWithId: {
        const id = this.i32()
        const meta = this.metas.get(this.i32())
        if (!meta) throw new NrbfError(`unknown class metadata at ${at}`)
        return this.classValues(id, meta)
      }
      case Rec.ArraySinglePrimitive: {
        const id = this.i32()
        const length = this.i32()
        const prim = this.u8()
        let arr: NrbfValue
        if (prim === 2) {
          arr = this.bytes.slice(this.pos, this.pos + length) // a byte array: copy it out
          this.pos += length
        } else {
          arr = Array.from({ length }, () => this.primitive(prim))
        }
        this.objects.set(id, arr)
        return arr
      }
      case Rec.ArraySingleObject:
      case Rec.ArraySingleString: {
        const id = this.i32()
        const arr = this.elements(this.i32())
        this.objects.set(id, arr)
        return arr
      }
      case Rec.BinaryArray: {
        const id = this.i32()
        const kind = this.u8()
        const rank = this.i32()
        const lengths = Array.from({ length: rank }, () => this.i32())
        if (kind >= 3) for (let i = 0; i < rank; i++) this.i32() // lower bounds
        const elemType = this.u8()
        let prim: number | null = null
        if (elemType === Bin.Primitive || elemType === Bin.PrimitiveArray) prim = this.u8()
        else if (elemType === Bin.SystemClass) this.string()
        else if (elemType === Bin.Class) {
          this.string()
          this.i32()
        }
        const total = lengths.reduce((a, b) => a * b, 1)
        let arr: NrbfValue[]
        if (elemType === Bin.Primitive && prim !== null) {
          if (prim === 2) {
            const bytes = this.bytes.slice(this.pos, this.pos + total)
            this.pos += total
            this.objects.set(id, bytes)
            return bytes
          }
          arr = Array.from({ length: total }, () => this.primitive(prim!))
        } else {
          arr = this.elements(total)
        }
        this.objects.set(id, arr)
        return arr
      }
      default:
        throw new NrbfError(`unknown record type ${type} at ${at}`)
    }
  }

  private elements(length: number): NrbfValue[] {
    const arr: NrbfValue[] = []
    while (arr.length < length) {
      const v = this.record()
      if (v instanceof Nulls) for (let i = 0; i < v.count; i++) arr.push(null)
      else arr.push(v as NrbfValue)
    }
    return arr
  }

  private classValues(id: number, meta: ClassMeta): NrbfObject {
    const obj: NrbfObject = { $class: meta.name }
    this.objects.set(id, obj)
    meta.members.forEach((m, i) => {
      const t = meta.types?.[i]
      obj[m] = t === Bin.Primitive ? this.primitive(meta.primitives[i]!) : (this.record() as NrbfValue)
    })
    return obj
  }
}

const END = Symbol('end')
