import Dexie, { type EntityTable } from 'dexie'

interface Row {
  key: string
  value: unknown
}

// Simple key-value store for now; campaigns/scenes get their own tables later.
const db = new Dexie('imaginevtt') as Dexie & { kv: EntityTable<Row, 'key'> }
db.version(1).stores({ kv: 'key' })

export async function load<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function save(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}
