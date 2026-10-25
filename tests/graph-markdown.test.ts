// The graph page's markdown renderer (#273, spec #270 Testing seam 3): a pure
// module, markdown in and an HTML string out, run in node. The reference
// table is the owner's dispatch-matrix Knowledge note, trimmed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTITY_SECTIONS, renderMarkdown } from '../src/graph/client/markdown.js'
import { structuralSectionsFor, WIKI_LINK_RE } from '../src/document.js'

const matrix = readFileSync(join(import.meta.dirname, 'fixtures/markdown/dispatch-matrix.md'), 'utf-8')

describe('renderMarkdown', () => {
  it('renders the dispatch matrix as a table, not pipe soup', () => {
    const html = renderMarkdown(matrix)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Dimension</th>')
    expect(html).toContain('<th>Claude Code (<code>claude</code>)</th>')
    // 17 body rows under one header row
    expect(html.match(/<tr>/g)).toHaveLength(18)
    // An escaped pipe inside a code span stays in its cell
    expect(html).toContain('<td><code>-s workspace-write|read-only|danger-full-access</code></td>')
    expect(html).toContain('<td><strong>Key gotcha</strong></td>')
    expect(html).not.toContain('|---|')
  })

  it('renders nested lists', () => {
    const html = renderMarkdown('- one\n  - one.a\n    1. deep\n- two\n')
    expect(html).toBe('<ul>\n<li>one\n<ul>\n<li>one.a\n<ol>\n<li>deep</li>\n</ol>\n</li>\n</ul>\n</li>\n<li>two</li>\n</ul>\n')
  })

  it('renders a code fence verbatim, its markdown and HTML left as text', () => {
    const html = renderMarkdown('```ts\nconst a = **b** <i>\n## not a heading\n```\n')
    expect(html).toBe('<pre><code class="language-ts">const a = **b** &lt;i&gt;\n## not a heading\n</code></pre>\n')
  })

  it('turns [[slug]] into an in-page link carrying the slug', () => {
    expect(renderMarkdown('see [[agent-fleet]] now')).toBe(
      '<p>see <a class="wiki" href="?focus=agent-fleet" data-slug="agent-fleet">agent-fleet</a> now</p>\n')
  })

  it('turns [[slug|label]] into a link showing the label', () => {
    expect(renderMarkdown('[[ agent-fleet | the fleet ]]')).toBe(
      '<p><a class="wiki" href="?focus=agent-fleet" data-slug="agent-fleet">the fleet</a></p>\n')
  })

  it('leaves [[...]] inside code alone', () => {
    expect(renderMarkdown('`opus[[1m]]`')).toBe('<p><code>opus[[1m]]</code></p>\n')
  })

  it('escapes raw HTML: <script> and <img onerror> come out as text', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nhi <img src=x onerror="alert(1)">\n')
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p>hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>\n')
  })

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'data:text/html,x', 'data:image/png;base64,AAAA'])(
    'drops a %s link', url => {
      const html = renderMarkdown(`[click](${url}) <${url}>`)
      expect(html).not.toContain('<a')
      expect(html).not.toContain('href')
    })

  it('renders an image as its alt text and never fetches it', () => {
    expect(renderMarkdown('![the *dispatch* graph](https://example.com/x.png)')).toBe('<p>the dispatch graph</p>\n')
  })

  it('opens a link in a new tab with noopener noreferrer', () => {
    expect(renderMarkdown('[docs](https://example.com/a?b=1&c=2)')).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>\n')
  })

  it('renders action text inline, with no paragraph around it', () => {
    expect(renderMarkdown('Ship **#273** via `npm test`, see [[agent-fleet]] @dev', { inline: true })).toBe(
      'Ship <strong>#273</strong> via <code>npm test</code>, see <a class="wiki" href="?focus=agent-fleet" data-slug="agent-fleet">agent-fleet</a> @dev')
  })
})

describe('renderMarkdown, one section of an Entity body', () => {
  const body = [
    '## Purpose', '', 'Why it exists.', '', '### Current State', '', 'Mid-flight.', '',
    '## Brief', '', '# Audit', '', 'Status: **green**.', '', '---', '', '## 1. Type system', '', 'Landed.', '',
    '```md', '## Next Actions', '```', '', '## Decisions', '', 'A session heading quoted here.', '',
    '## Next Actions', '', '- [ ] Ship it', '',
  ].join('\n')

  it('renders only the Brief, its own headings and rules included', () => {
    expect(renderMarkdown(body, { section: 'Brief' })).toBe([
      '<h1>Audit</h1>', '<p>Status: <strong>green</strong>.</p>', '<hr>', '<h2>1. Type system</h2>', '<p>Landed.</p>',
      '<pre><code class="language-md">## Next Actions', '</code></pre>', '<h2>Decisions</h2>', '<p>A session heading quoted here.</p>', '',
    ].join('\n'))
  })

  it.each([...structuralSectionsFor({ kind: 'entity' })].filter(name => name !== 'Brief'))(
    'ends the Brief at the next ## %s, as the Document module does', name => {
      expect(renderMarkdown(`## Brief\n\nkept\n\n## ${name}\n\ndropped\n`, { section: 'Brief' })).toBe('<p>kept</p>\n')
    })

  it('renders nothing when the section is absent', () => {
    expect(renderMarkdown('## Purpose\n\nWhy.\n', { section: 'Brief' })).toBe('')
  })

  it('bounds sections by exactly the Document module\'s Entity headings, none missing and none extra', () => {
    expect(new Set(ENTITY_SECTIONS)).toEqual(new Set(structuralSectionsFor({ kind: 'entity' })))
  })
})

describe('renderMarkdown, wiki-links as the Document module reads them', () => {
  /** What WIKI_LINK_RE (src/document.ts) makes of a text: the first link's slug and label. */
  const documentReads = (text: string) => {
    const m = WIKI_LINK_RE.exec(text)
    return m ? { slug: m[1], label: m[2] ?? m[1] } : null
  }
  /** What the page makes of it: the first wiki-link's data-slug and text. */
  const pageReads = (text: string) => {
    const m = /<a class="wiki" [^>]*data-slug="([^"]*)">([^<]*)<\/a>/.exec(renderMarkdown(text))
    return m ? { slug: m[1], label: m[2] } : null
  }

  it.each(['[[s]]', '[[ s ]]', '[[s | L]]', '[[ s|L ]]', '[[a|b|c]]', '[[s', '[[s|]]', '[[]]', '[[x [[y]]', 'see [[agent-fleet]] now'])(
    'reads %s as the Document module does', text => {
      expect(pageReads(text)).toEqual(documentReads(text))
    })
})
