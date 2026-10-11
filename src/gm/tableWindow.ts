/** Open (or bring up) the table window, to be dragged to the TV. */
export function openTableWindow() {
  window.open(`${location.pathname}?view=table`, 'imaginevtt-table', 'popup,width=1280,height=720')
}
