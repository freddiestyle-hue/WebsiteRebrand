import { marked } from 'marked';

export interface ParsedPost {
  tldrHtml: string;
  bodyHtml: string;
  faq: Array<{ q: string; a: string }>;
  toc: Array<{ id: string; label: string }>;
}

const SECTION_PREFIX = (n: number) => String(n).padStart(2, '0');

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const renderInline = (md: string) => {
  const html = marked.parseInline(md, { async: false }) as string;
  return html;
};

export function parsePost(rawBody: string): ParsedPost {
  let body = rawBody.trim();

  let tldrHtml = '';
  const tldrMatch = body.match(/^\*\*TL;DR:\*\*\s*([\s\S]*?)\n\s*\n/);
  if (tldrMatch) {
    tldrHtml = renderInline(tldrMatch[1].trim());
    body = body.slice(tldrMatch[0].length).trim();
  }

  let faqRaw = '';
  const faqIdx = body.search(/\n## FAQ\b/);
  if (faqIdx >= 0) {
    faqRaw = body.slice(faqIdx).replace(/^\n## FAQ\s*/, '').trim();
    body = body.slice(0, faqIdx).trim();
  }

  const faq: Array<{ q: string; a: string }> = [];
  if (faqRaw) {
    const blocks = faqRaw.split(/\n\s*\n/);
    for (const rawBlock of blocks) {
      const block = rawBlock.trim();
      if (!block) continue;
      const m = block.match(/^\*\*(.+?)\*\*\s*\n([\s\S]+)$/);
      if (m) {
        faq.push({
          q: renderInline(m[1].trim()),
          a: renderInline(m[2].trim()),
        });
      }
    }
  }

  const toc: Array<{ id: string; label: string }> = [{ id: 'tldr', label: 'TL;DR' }];
  let sectionCounter = 0;

  const renderer = new marked.Renderer();
  const baseHeading = renderer.heading.bind(renderer);
  renderer.heading = (token: any) => {
    const depth: number = token.depth;
    const text: string = token.text;
    if (depth === 2) {
      sectionCounter += 1;
      const id = slugify(text) || `section-${sectionCounter}`;
      const label = text;
      toc.push({ id, label });
      const inner = marked.parseInline(text, { async: false }) as string;
      const num = SECTION_PREFIX(sectionCounter);
      return `<h2 id="${id}"><span class="num">${num}</span><span class="text">${inner}</span></h2>\n`;
    }
    return baseHeading(token);
  };

  let firstParaSeen = false;
  const baseParagraph = renderer.paragraph.bind(renderer);
  renderer.paragraph = (token: any) => {
    const html = baseParagraph(token);
    if (!firstParaSeen) {
      firstParaSeen = true;
      return html.replace(/^<p>/, '<p class="lede-p">');
    }
    return html;
  };

  const bodyHtml = marked.parse(body, { renderer, async: false }) as string;
  toc.push({ id: 'faq', label: 'FAQ' });

  return { tldrHtml, bodyHtml, faq, toc };
}
