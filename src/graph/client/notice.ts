// src/graph/client/notice.ts
// A short notice over the top of the canvas (#279): what the page just did
// that the user did not ask for in so many words, such as turning on
// Everything or Knowledge to show a picked note. A polite status, gone after
// a few seconds or on the next notice.
import { el } from './shell.js'

const SHOWN_MS = 5000

/** Mount the notice into `host`; returns the way to say something. */
export function mountNotice(host: HTMLElement): (text: string) => void {
  const box = el('div', { id: 'notice', class: 'popover', role: 'status', hidden: '' })
  host.append(box)
  let timer: ReturnType<typeof setTimeout> | undefined
  return text => {
    box.textContent = text
    box.hidden = false
    clearTimeout(timer)
    timer = setTimeout(() => { box.hidden = true }, SHOWN_MS)
  }
}
