// src/graph/fonts.ts
// The page's bundled fonts (#272), plain data shared by the build, the
// server's `/fonts/` allowlist and the page's stylesheet. Each is a latin
// variable-weight woff2 from a devDependency, copied into dist/graph/fonts/ at
// build with its OFL licence beside it: the package gains no runtime dependency.

export interface Font {
  /** The CSS family the token sheet's stacks name. */
  family: string
  /** The served name under `/fonts/`; the licence is `<file stem>-OFL.txt`. */
  file: string
  /** The devDependency it is copied from, and the woff2 inside it. */
  pkg: string
  src: string
}

export const FONTS: readonly Font[] = [
  { family: 'Geist', file: 'geist.woff2', pkg: '@fontsource-variable/geist', src: 'files/geist-latin-wght-normal.woff2' },
  { family: 'Geist Mono', file: 'geist-mono.woff2', pkg: '@fontsource-variable/geist-mono', src: 'files/geist-mono-latin-wght-normal.woff2' },
  { family: 'Outfit', file: 'outfit.woff2', pkg: '@fontsource-variable/outfit', src: 'files/outfit-latin-wght-normal.woff2' },
]

/** The served name of a font's licence. */
export const licenceFile = (font: Font): string => font.file.replace(/\.woff2$/, '-OFL.txt')

/** Every file `/fonts/` serves, by served name: what the build copies, from where in node_modules. */
export const FONT_FILES: ReadonlyMap<string, string> = new Map(FONTS.flatMap(f => [
  [f.file, `${f.pkg}/${f.src}`],
  [licenceFile(f), `${f.pkg}/LICENSE`],
] as Array<[string, string]>))
