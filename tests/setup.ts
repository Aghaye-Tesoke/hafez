// A git identity for every test, from a .gitconfig in a temp HOME rather than
// GIT_AUTHOR_* env: simple-git 4 strips ambient GIT_* keys from the child env,
// so env identity reached hafez's own git calls but not the tests' fixtures.
// The temp HOME also hides the machine's git config — every place git reads it
// from — so the suite runs the same on the dev box as on a clean runner.
import { afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const home = mkdtempSync(join(tmpdir(), 'hafez-test-home-'))
writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Hafez Test\n\temail = test@hafez.invalid\n')
process.env.HOME = home
process.env.USERPROFILE = home // os.homedir() reads USERPROFILE on Windows, not HOME
process.env.XDG_CONFIG_HOME = join(home, '.config')
delete process.env.GIT_CONFIG_GLOBAL
delete process.env.GIT_CONFIG_SYSTEM
// One per test file (setupFiles run per file); removed when the file's tests are done.
afterAll(() => rmSync(home, { recursive: true, force: true }))

delete process.env.GIT_EDITOR
delete process.env.VISUAL
delete process.env.EDITOR
