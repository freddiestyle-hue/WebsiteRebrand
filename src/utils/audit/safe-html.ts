/**
 * Allowlist-based HTML sanitizer for memo content.
 *
 * Memo bodyParagraphs, finding paragraphs, and personalObservation.text are
 * written by Codex synthesis. Codex usually emits clean prose with a small
 * set of inline tags (<code>, <strong>, <em>, <br>) for emphasis. But Codex
 * is an LLM and its input includes prospect-controlled site content, so
 * prompt injection could theoretically produce <script> in memo output.
 *
 * Strategy: HTML-encode everything, then selectively restore the allowlist
 * of tags without attributes. Nothing else survives. No attribute-based
 * vectors (onerror, javascript: hrefs, etc.) possible because we strip
 * attributes entirely.
 *
 * Threat model: the Astro route uses set:html for memo strings. Without
 * sanitization, a memo containing `<script>alert(1)</script>` executes JS
 * on rivett.tech. With sanitization, that string renders as literal text.
 */

const ALLOWED_TAGS = ['code', 'strong', 'em', 'b', 'i', 'br'] as const;

const ENCODE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function encode(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENCODE_MAP[c]);
}

export function sanitizeMemoHtml(input: string | null | undefined): string {
  if (input == null || input === '') return '';

  let s = encode(input);

  // Restore allowlisted opening tags. Match the encoded form (&lt;tag&gt;)
  // case-insensitively. Reject anything with attributes (whitespace or
  // attribute syntax inside the tag) by anchoring to the exact closing &gt;.
  for (const tag of ALLOWED_TAGS) {
    const openRe = new RegExp(`&lt;${tag}&gt;`, 'gi');
    const closeRe = new RegExp(`&lt;/${tag}&gt;`, 'gi');
    s = s.replace(openRe, `<${tag}>`);
    s = s.replace(closeRe, `</${tag}>`);
  }
  // Allow self-closing <br/> and <br />
  s = s.replace(/&lt;br\s*\/&gt;/gi, '<br/>');

  return s;
}

/**
 * Sanitize each string in an array. Convenience for bodyParagraphs / findings paragraphs.
 */
export function sanitizeMemoHtmlList(input: string[] | null | undefined): string[] {
  if (!input) return [];
  return input.map(sanitizeMemoHtml);
}
