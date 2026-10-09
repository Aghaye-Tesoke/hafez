// tests/closest.test.ts
//
// The closest slugs a `read` miss offers (#91): by name first, description
// second. The cases are the misses in the usage research — a slug guessed
// from the repo folder name.

import { describe, it, expect } from 'vitest'
import { closestSlugs, type SlugCandidate } from '../src/closest.js'

const row = (slug: string, name: string, description: string | null = null): SlugCandidate => ({ slug, name, description })

const VAULT: SlugCandidate[] = [
  row('efms-tool-mentoring', 'EFMS Tool Mentoring', 'Mentoring a colleague through the tool'),
  row('meeting-transcript-pipeline', 'Meeting Transcript Pipeline', 'Audio to notes'),
  row('farsi-meeting-transcription-script', 'Farsi Meeting Transcription Script'),
  row('agentic-sdlc-engagement', 'Agentic SDLC Engagement', 'The Thales engagement on agent-driven delivery'),
  row('hafez-landing-page', 'Hafez Landing Page', 'The public page for the vault'),
  row('royston-budget', 'Royston Budget', 'The FY budget round'),
  row('launch-checklist', 'Launch Checklist'),
]

describe('closestSlugs', () => {
  it('offers a slug whose name holds every word of the miss', () => {
    expect(closestSlugs('efms-tool', VAULT)).toEqual(['efms-tool-mentoring'])
  })

  it('ranks a full name match above a partial one', () => {
    const rows = [row('meeting-notes', 'Meeting Notes'), row('meeting-transcriber-v2', 'Meeting Transcriber V2')]
    expect(closestSlugs('meeting-transcriber', rows)).toEqual(['meeting-transcriber-v2', 'meeting-notes'])
  })

  it('offers half-matching names when nothing matches in full', () => {
    expect(closestSlugs('meeting-transcriber', VAULT)).toEqual([
      'meeting-transcript-pipeline',
      'farsi-meeting-transcription-script',
    ])
  })

  it('counts a word found only in the description at half weight', () => {
    expect(closestSlugs('thales-sdlc', VAULT)).toEqual(['agentic-sdlc-engagement'])
    expect(closestSlugs('thales', VAULT)).toEqual(['agentic-sdlc-engagement'])
  })

  it('needs at least half the words: one description word of two is not close', () => {
    expect(closestSlugs('thales-onboarding', VAULT)).toEqual([])
  })

  it('matches a plural, a cut-short word and a one-letter typo', () => {
    expect(closestSlugs('checklists', VAULT)).toEqual(['launch-checklist'])
    expect(closestSlugs('budg', VAULT)).toEqual(['royston-budget'])
    expect(closestSlugs('budgret', VAULT)).toEqual(['royston-budget'])
  })

  it('does not stretch a short word into a prefix match', () => {
    expect(closestSlugs('lau', VAULT)).toEqual([])
  })

  it('does not match a longer word to a name word it merely starts with', () => {
    expect(closestSlugs('launchpads', VAULT)).toEqual([])
  })

  it('ignores stopwords in the miss', () => {
    expect(closestSlugs('the-vault', VAULT)).toEqual(['hafez-landing-page'])
  })

  it('breaks a score tie toward the name the miss covers most', () => {
    const rows = [row('hafez-hooks-integration', 'Hafez Hooks Integration'), row('hafez-cli', 'Hafez CLI')]
    expect(closestSlugs('hafez', rows)).toEqual(['hafez-cli', 'hafez-hooks-integration'])
  })

  it('returns at most five', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`dashboard-${i}`, `Dashboard ${i}`))
    expect(closestSlugs('dashboard', rows)).toHaveLength(5)
  })

  it('matches on the slug when the name has drifted from it', () => {
    expect(closestSlugs('old-name', [row('old-name-tracker', 'Renamed Thing')])).toEqual(['old-name-tracker'])
  })
})
