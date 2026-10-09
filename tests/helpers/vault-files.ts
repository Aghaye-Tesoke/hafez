// tests/helpers/vault-files.ts
// Kind-narrowing readers for vault files. parseFilePath() and read() return
// a kind-discriminated union; a test that reads `entities/foo.md` knows which
// arm it wants, so it asserts the kind once here and gets the narrowed
// frontmatter back instead of sniffing keys on the union.
import { parseFilePath } from '../../src/vault.js'
import type { EntityFrontmatter, KnowledgeFrontmatter, ParsedFile, ParsedVaultFile } from '../../src/types.js'

type Kinded = ParsedVaultFile | ParsedFile

export function asEntity(file: Kinded): { frontmatter: EntityFrontmatter; body: string } {
  if (file.kind !== 'entity') throw new Error(`expected an entity file, got kind=${file.kind}`)
  return { frontmatter: file.frontmatter, body: file.body }
}

export function asKnowledge(file: Kinded): { frontmatter: KnowledgeFrontmatter; body: string } {
  if (file.kind !== 'knowledge') throw new Error(`expected a knowledge file, got kind=${file.kind}`)
  return { frontmatter: file.frontmatter, body: file.body }
}

export function readEntity(path: string): { frontmatter: EntityFrontmatter; body: string } {
  return asEntity(parseFilePath(path))
}

export function readKnowledge(path: string): { frontmatter: KnowledgeFrontmatter; body: string } {
  return asKnowledge(parseFilePath(path))
}
