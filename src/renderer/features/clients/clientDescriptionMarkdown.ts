import { Marked, Renderer } from 'marked';

const DESCRIPTION_LINK_ALLOWED_HOSTS = ['api.loontail.tld'] as const;
const LINK_TARGET = '_blank';
const LINK_REL = 'noreferrer noopener';
const MIN_HEADING_DEPTH = 1;
const MAX_HEADING_DEPTH = 6;

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character] ?? character);

const isAllowedDescriptionHost = (hostname: string): boolean => {
  const normalizedHost = hostname.toLowerCase();
  return DESCRIPTION_LINK_ALLOWED_HOSTS.some(
    (allowedHost) => normalizedHost === allowedHost || normalizedHost.endsWith(`.${allowedHost}`),
  );
};

const toSafeDescriptionUrl = (rawUrl: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!isAllowedDescriptionHost(parsed.hostname)) return null;

  return parsed.toString();
};

const descriptionRenderer = new Renderer();
type DescriptionRendererContext = Renderer<string, string>;

descriptionRenderer.html = () => '';
descriptionRenderer.hr = () => '';
descriptionRenderer.table = () => '';
descriptionRenderer.tablerow = () => '';
descriptionRenderer.tablecell = () => '';
descriptionRenderer.checkbox = () => '';
descriptionRenderer.br = () => '';

descriptionRenderer.heading = function (this: DescriptionRendererContext, { tokens, depth }) {
  const headingDepth = Math.min(Math.max(Math.trunc(depth), MIN_HEADING_DEPTH), MAX_HEADING_DEPTH);
  return `<h${headingDepth}>${this.parser.parseInline(tokens)}</h${headingDepth}>\n`;
};

descriptionRenderer.paragraph = function (this: DescriptionRendererContext, { tokens }) {
  return `<p>${this.parser.parseInline(tokens)}</p>\n`;
};

descriptionRenderer.blockquote = function (this: DescriptionRendererContext, { tokens }) {
  return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`;
};

descriptionRenderer.list = function (this: DescriptionRendererContext, token) {
  const tagName = token.ordered ? 'ol' : 'ul';
  const items = token.items.map((item) => this.listitem(item)).join('');
  return `<${tagName}>\n${items}</${tagName}>\n`;
};

descriptionRenderer.listitem = function (this: DescriptionRendererContext, { tokens }) {
  return `<li>${this.parser.parse(tokens)}</li>\n`;
};

descriptionRenderer.strong = function (this: DescriptionRendererContext, { tokens }) {
  return `<strong>${this.parser.parseInline(tokens)}</strong>`;
};

descriptionRenderer.em = function (this: DescriptionRendererContext, { tokens }) {
  return `<em>${this.parser.parseInline(tokens)}</em>`;
};

descriptionRenderer.del = function (this: DescriptionRendererContext, { tokens }) {
  return this.parser.parseInline(tokens);
};

descriptionRenderer.code = ({ text }) => `<pre><code>${escapeHtml(text)}</code></pre>\n`;

descriptionRenderer.codespan = ({ text }) => `<code>${escapeHtml(text)}</code>`;

descriptionRenderer.link = function (this: DescriptionRendererContext, { href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const safeUrl = toSafeDescriptionUrl(href);
  if (!safeUrl) return label;

  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safeUrl)}"${titleAttribute} target="${LINK_TARGET}" rel="${LINK_REL}">${label}</a>`;
};

descriptionRenderer.image = ({ text }) => escapeHtml(text);

const descriptionMarkdown = new Marked<string, string>({
  async: false,
  breaks: false,
  gfm: true,
  renderer: descriptionRenderer,
});

export const renderClientDescriptionMarkdown = (description: string): string =>
  descriptionMarkdown.parse(description, { async: false });
