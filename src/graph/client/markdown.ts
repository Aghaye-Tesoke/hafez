// src/graph/client/markdown.ts
// The panel's markdown renderer (#273): markdown in, an HTML string out, on
// markdown-it (a devDependency esbuild bundles into the page). Pure: no DOM,
// so it runs in node under vitest.
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false })

/** The Vault's wiki-link, `[[slug]]` or `[[slug|label]]`, padding absorbed:
 * `WIKI_LINK_RE` in src/document.ts, anchored (the bundle can't import it; a
 * test holds the two to one reading). */
const WIKI_LINK = /^\[\[\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/

md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  if (!state.src.startsWith('[[', state.pos)) return false
  const match = WIKI_LINK.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) {
    const token = state.push('wikilink', '', 0)
    token.meta = { slug: match[1], label: match[2] ?? match[1] }
  }
  state.pos += match[0].length
  return true
})

md.renderer.rules.wikilink = (tokens, i) => {
  const { slug, label } = tokens[i].meta as { slug: string; label: string }
  const esc = md.utils.escapeHtml
  return `<a class="wiki" href="?focus=${esc(encodeURIComponent(slug))}" data-slug="${esc(slug)}">${esc(label)}</a>`
}

/** markdown-it's own check, minus its allowance for `data:image/…`: a link to
 * any of these schemes stays literal text. */
const BAD_SCHEME = /^(javascript|vbscript|file|data):/
md.validateLink = url => !BAD_SCHEME.test(url.trim().toLowerCase())

// An image is its alt text: a note never makes the page fetch anything.
md.renderer.rules.image = (tokens, i, options, env, self) =>
  md.utils.escapeHtml(self.renderInlineAsText(tokens[i].children ?? [], options, env))

// A markdown link leaves the page for a new tab; wiki-links stay in it.
md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
  tokens[i].attrSet('target', '_blank')
  tokens[i].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, i, options)
}

/** The headings that bound an Entity's sections: `structuralSectionsFor({
 * kind: 'entity' })` in src/document.ts (a test holds the two equal). Any
 * other `## ` heading, a Brief's own included, is the section's text. */
export const ENTITY_SECTIONS: ReadonlySet<string> = new Set(['Notes', 'Context', 'Purpose', 'Goals', 'Brief', 'Next Actions', 'Current State', 'Open Questions', 'Session Log', 'Related'])

export interface RenderOpts {
  /** One line of inline markdown (an action's text): no block elements, no `<p>`. */
  inline?: boolean
  /** Only this `## ` section of an Entity body (the Brief); '' when absent. */
  section?: string
}

/** Note text as HTML safe for innerHTML: raw HTML escaped, script-capable
 * and file links dropped, images as their alt text, wiki-links as in-page
 * links carrying `data-slug`. */
export function renderMarkdown(text: string, opts: RenderOpts = {}): string {
  if (opts.inline) return md.renderInline(text)
  if (opts.section === undefined) return md.render(text)
  const env = {}
  const tokens = md.parse(text, env)
  const h2 = (i: number) => tokens[i].type === 'heading_open' && tokens[i].tag === 'h2' && tokens[i].level === 0
  const title = (i: number) => tokens[i + 1].content.trim()
  const start = tokens.findIndex((_, i) => h2(i) && title(i) === opts.section)
  if (start < 0) return ''
  const end = tokens.findIndex((_, i) => i > start && h2(i) && ENTITY_SECTIONS.has(title(i)))
  // A heading is three tokens: open, inline, close.
  return md.renderer.render(tokens.slice(start + 3, end < 0 ? undefined : end), md.options, env)
}
