import { Marked } from 'marked';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

// Markdown is stored as written and rendered to HTML on the SERVER, then sanitised with DOMPurify
// (a real HTML parser, so it resists mutation-XSS tricks that regex/tokenizer sanitisers miss).
// One place, one policy: the client only ever injects HTML that went through here.
//
// Allow-list: formatting, lists, tables, links. Deliberately excluded: images (tracking pixels /
// hotlinking), iframes, forms, styles, scripts, event handlers, data-* / aria-* attributes, and
// any URL scheme other than http(s)/mailto (no javascript:, no relative URLs).
const purify = createDOMPurify(new JSDOM('').window);

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

purify.addHook('afterSanitizeAttributes', (node) => {
  // Every surviving link opens safely in a new tab (set AFTER attribute filtering, so authors cannot override it).
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('rel', 'noopener noreferrer nofollow');
    node.setAttribute('target', '_blank');
  }
});

const SAFE = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: ['href', 'title'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

// Keep a single page-level <h1> (the article title): demote any markdown "# heading" to h2.
const marked = new Marked({
  gfm: true,
  async: false,
  renderer: {
    heading(text, level) {
      const l = Math.min(Math.max(level, 2), 4);
      return `<h${l}>${text}</h${l}>\n`;
    },
  },
});

const parse = (md) => marked.parse(md);

export const renderMarkdown = (md) => purify.sanitize(parse(md), SAFE);

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

// Plain-text teaser for lists and search results.
export function plainSnippet(md, max = 160) {
  const text = purify
    .sanitize(parse(md), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
