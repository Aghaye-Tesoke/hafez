// src/graph/copy-fonts.ts
// Build step (#272), run as `node dist/graph/copy-fonts.js` after tsc: copy
// the page's fonts and their licences from the devDependencies into
// dist/graph/fonts/, where the server's `/fonts/` route reads them.
import { copyFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { FONT_FILES } from './fonts.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'dist', 'graph', 'fonts')
mkdirSync(out, { recursive: true })
for (const [file, from] of FONT_FILES) copyFileSync(join(root, 'node_modules', from), join(out, file))
