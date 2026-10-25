import { describe, expect, it } from 'vitest'
import { hostSlug, isPathResource, normalizePath } from '../src/graph/heat/paths.js'

describe('normalizePath', () => {
  it('lowercases, forward-slashes, and strips a trailing slash', () => {
    expect(normalizePath('D:\\CLAUDE\\AUTOMAZON\\')).toBe('d:/claude/automazon')
  })
  it('maps a WSL mount to a drive', () => {
    expect(normalizePath('/mnt/d/Claude/amazonica')).toBe('d:/claude/amazonica')
  })
  it('drops a trailing branch note', () => {
    expect(normalizePath('C:/Users/aryan/repos/voice-checkin (branch build/v1)')).toBe('c:/users/aryan/repos/voice-checkin')
  })
})

describe('isPathResource', () => {
  it('rejects URLs', () => {
    expect(isPathResource('https://cadbase.ai')).toBe(false)
    expect(isPathResource('www.notion.so/x')).toBe(false)
    expect(isPathResource('D:/Claude/amazonica')).toBe(true)
  })
})

describe('hostSlug', () => {
  const resources = [
    { slug: 'automazon', resource: 'D:\\CLAUDE\\AUTOMAZON' },
    { slug: 'amazon-ppc-brain', resource: 'D:\\CLAUDE\\Shopify\\automazon' },
    { slug: 'cadbase-website', resource: 'https://cadbase.ai' },
    { slug: 'no-resource', resource: null },
  ]
  it('matches a cwd equal to a resource, case and separators aside', () => {
    expect(hostSlug('d:/claude/automazon', resources)).toBe('automazon')
  })
  it('matches a cwd under a resource, longest prefix first', () => {
    expect(hostSlug('D:\\CLAUDE\\Shopify\\automazon\\src', resources)).toBe('amazon-ppc-brain')
  })
  it('does not match across a name boundary', () => {
    expect(hostSlug('D:/CLAUDE/AUTOMAZON2', resources)).toBeUndefined()
  })
  it('never matches a URL or a missing resource', () => {
    expect(hostSlug('https://cadbase.ai', resources)).toBeUndefined()
  })
})
