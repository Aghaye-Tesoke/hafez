// src/digest.ts
import { createHash } from 'crypto'
import { z } from 'zod'
import { HafezError, type BatchOperation, type UpdateFields } from './types.js'
import type { CreateSessionFieldsInput } from './batch-ops.js'
import { detectAgent } from './harness.js'
import { ITEMS } from './surfaces/items.js'

// --- Schema ---

export const DigestInputSchema = z.object({
  entities_touched: z.array(z.string())
    .describe('Slugs of entities worked on. Each gets a session log entry; the session note links them all. An unknown slug fails the digest and is named.'),
  decisions: z.array(z.string())
    .describe('Key decisions made this session (may be empty). Recorded in the session note.')
    .default([]),
  narrative: z.string().min(1)
    .describe('1-3 sentence cross-cutting summary — what happened, connections discovered.'),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .describe('Session date, YYYY-MM-DD.'),
  agent: z.string()
    .describe('Agent identifier recorded in session logs. Detected from the Harness when absent.')
    .optional(),
})

export type DigestInput = z.infer<typeof DigestInputSchema>

/**
 * Validate and parse raw digest input from stdin.
 * Returns unknown fields so callers can warn on stderr.
 * Uses strict() parse to detect unknown keys, then normal parse for the clean result.
 */
export function parseDigestInput(raw: unknown): { success: true; data: DigestInput; unknownFields: string[] } | { success: false; error: z.ZodError } {
  const result = DigestInputSchema.safeParse(raw)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  // Detect unknown fields via strict parse (Zod's unrecognized_keys error code)
  const unknownFields: string[] = []
  const strictResult = DigestInputSchema.strict().safeParse(raw)
  if (!strictResult.success) {
    for (const issue of strictResult.error.issues) {
      if (issue.code === 'unrecognized_keys') unknownFields.push(...(issue as any).keys)
    }
  }

  return { success: true, data: result.data, unknownFields }
}

/**
 * Convert session context into a hafez batch payload.
 * Pure function — no file I/O, no vault access.
 * An unknown slug in entities_touched is a NOT_FOUND naming it (and only the
 * unknown ones), never a session log that points nowhere. A knowledge slug is
 * known: the note links it, but a session log is entity-only.
 */
export function digest(input: DigestInput, entitySlugs: Set<string>, knowledgeSlugs: Set<string> = new Set()): BatchOperation[] {
  const touched = [...new Set(input.entities_touched)]
  const unknown = touched.filter(s => !entitySlugs.has(s) && !knowledgeSlugs.has(s))
  if (unknown.length > 0) throw new HafezError('NOT_FOUND', ITEMS.unknownSlugAtSave.render(unknown))

  const ops: BatchOperation[] = []
  const agent = input.agent || detectAgent()

  // 1. Session log updates for each touched entity
  for (const slug of touched.filter(s => entitySlugs.has(s))) {
    const sessionLogSummary = buildSessionLogSummary(input)
    const fields: UpdateFields = {
      session_log: {
        type: 'progress',
        summary: sessionLogSummary,
        agent,
      },
    }
    ops.push({ op: 'update', slug, fields })
  }

  // 2. Session note
  const related = touched
  // Typechecked against the Op Spec's session-create schema so digest output
  // can never silently diverge from what batch validation accepts.
  // A blank decision is dropped here: the Op Spec takes non-empty text only,
  // and one blank line must not fail the whole save. The name hash below still
  // reads the raw input, so the slug a save before this derived is unchanged.
  const decisions = input.decisions.map(d => d.trim()).filter(Boolean)
  const noteFields: CreateSessionFieldsInput = {
    synthesis: input.narrative.trim(),
    'session-date': input.session_date,
    ...(decisions.length > 0 ? { decisions } : {}),
    ...(related.length > 0 ? { related, entities_touched: touched } : {}),
  }
  // Named by the session date and its whole content, so a second save of the
  // same session derives the same slug and batch skips it as a duplicate.
  const noteName = `Session ${input.session_date} ${createHash('sha256').update(sessionIdentity(input, touched)).digest('hex').slice(0, 8)}`
  ops.push({ op: 'create', kind: 'session', name: noteName, fields: noteFields })

  return ops
}

// --- Helpers ---

function buildSessionLogSummary(input: DigestInput): string {
  const parts: string[] = [input.narrative.trim()]
  if (input.decisions.length > 0) {
    parts.push(`Decisions: ${input.decisions.join('; ')}`)
  }
  return parts.join(' | ')
}

/** What the session note's name hashes: narrative, decisions and touched
 * slugs, in the text the note body held before its sections were split
 * (#210), so a session saved before then is still skipped when saved again. */
function sessionIdentity(input: DigestInput, touched: string[]): string {
  const lines: string[] = [input.narrative.trim()]

  if (input.decisions.length > 0) {
    lines.push('')
    lines.push('**Decisions:**')
    for (const d of input.decisions) {
      lines.push(`- ${d}`)
    }
  }

  if (touched.length > 0) {
    lines.push('')
    lines.push(`**Entities touched:** ${touched.join(', ')}`)
  }

  return lines.join('\n')
}
