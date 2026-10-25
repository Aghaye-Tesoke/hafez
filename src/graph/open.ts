// src/graph/open.ts
// Open a URL in the user's browser, best-effort: any failure is silent,
// because the URL is printed either way.
import { spawn } from 'child_process'
import { release } from 'os'

export function openBrowser(url: string): void {
  const wsl = process.platform === 'linux' && release().toLowerCase().includes('microsoft')
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    // cmd.exe splits a command at `&`: a focused URL (`?focus=…&depth=2`) needs it escaped.
    : process.platform === 'win32' || wsl ? ['cmd.exe', ['/c', 'start', url.replace(/&/g, '^&')]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // No opener on this machine: the printed URL is the way in.
  }
}
