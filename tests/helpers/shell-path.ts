// tests/helpers/shell-path.ts
// The process env with `dir` first on PATH, for tests that run a real shell
// against a shim. Windows spells the key `Path` and separates with ';': a
// second `PATH` key or a ':' join leaves the shim unfound.
import { delimiter } from 'path'

export function envWithPath(dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
  return { ...process.env, [key]: `${dir}${delimiter}${process.env[key] ?? ''}`, ...extra }
}
