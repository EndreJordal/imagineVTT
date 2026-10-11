import { useEffect, useRef, useState } from 'react'
import { HEARTBEAT_MS, openChannel } from '../shared/channel'
import { TableCanvas } from './TableCanvas'

const screenSize = () => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * Fullscreen either way: the browser's own (F11), which stays put when the GM opens a file
 * dialog, or the page's (double-click, the Fullscreen API), which Chrome drops whenever a
 * dialog opens, for security.
 */
function isFullscreen() {
  return (
    !!document.fullscreenElement ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.innerWidth >= screen.width && window.innerHeight >= screen.height)
  )
}

export function TableApp() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const [fullscreen, setFullscreen] = useState(isFullscreen)

  useEffect(() => {
    const canvas = new TableCanvas(hostRef.current!)
    const channel = openChannel((msg) => {
      switch (msg.type) {
        case 'gm-hello':
          channel.post({ type: 'hello', screen: screenSize() })
          break
        case 'state':
          canvas.setState(msg.state)
          setConnected(true)
          break
        case 'map':
          canvas.setMapImage(msg.image)
          break
        case 'fog':
          canvas.setFogMemory(msg.memory)
          break
        case 'assets':
          canvas.setObjectImages(msg.images)
          break
        case 'bye':
          if (msg.from === 'gm') setConnected(false)
          break
      }
    })
    channel.post({ type: 'hello', screen: screenSize() })

    const onResize = () => channel.post({ type: 'screen', screen: screenSize() })
    const heartbeat = window.setInterval(onResize, HEARTBEAT_MS)
    const onUnload = () => channel.post({ type: 'bye', from: 'table' })
    const onFullscreen = () => setFullscreen(isFullscreen())
    const onDoubleClick = () => {
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('dblclick', onDoubleClick)
    document.addEventListener('fullscreenchange', onFullscreen)
    window.addEventListener('resize', onFullscreen) // F11 shows up as a resize

    return () => {
      clearInterval(heartbeat)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pagehide', onUnload)
      window.removeEventListener('dblclick', onDoubleClick)
      document.removeEventListener('fullscreenchange', onFullscreen)
      window.removeEventListener('resize', onFullscreen)
      onUnload()
      channel.close()
      canvas.destroy()
    }
  }, [])

  return (
    <div className="table" style={{ cursor: fullscreen ? 'none' : undefined }}>
      <div className="table-canvas" ref={hostRef} />
      {(!connected || !fullscreen) && (
        <div className="table-hint">
          {connected
            ? 'Press F11 for fullscreen (stays put when the GM opens files; double-click also works, but file dialogs exit it)'
            : 'Waiting for the GM window…'}
        </div>
      )}
    </div>
  )
}
