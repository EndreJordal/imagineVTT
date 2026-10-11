import type { FogMemory } from './fog'
import type { AssetImages } from './mapObjects'
import type { Size, TableState } from './types'

/** Messages between the GM window and the table window (same origin, same machine). */
export type Message =
  | { type: 'gm-hello' } // gm -> table: GM (re)started, introduce yourself
  | { type: 'hello'; screen: Size } // table -> gm: just opened, send me everything
  | { type: 'screen'; screen: Size } // table -> gm: resized, and periodic heartbeat
  | { type: 'state'; state: TableState } // gm -> table
  | { type: 'map'; image: Blob | null } // gm -> table: map image changed
  | { type: 'fog'; memory: FogMemory | null } // gm -> table: fog memory changed
  | { type: 'assets'; images: AssetImages } // gm -> table: images of the objects placed
  | { type: 'bye'; from: 'gm' | 'table' }

/** Table heartbeat interval; the GM treats the table as gone after a few missed beats. */
export const HEARTBEAT_MS = 2000

export interface Channel {
  post(message: Message): void
  close(): void
}

export function openChannel(onMessage: (message: Message) => void): Channel {
  const channel = new BroadcastChannel('imaginevtt')
  channel.onmessage = (e: MessageEvent<Message>) => onMessage(e.data)
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
  }
}
