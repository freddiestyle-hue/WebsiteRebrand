const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function stripHtml(input: string): string {
  if (!input) return '';
  const noTags = input.replace(/<[^>]+>/g, '');
  const decoded = noTags.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
  return decoded.replace(/\s+/g, ' ').trim();
}

export function clamp(input: string, max: number): string {
  if (!input) return '';
  if (input.length <= max) return input;
  const sliced = input.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${base.trim()}…`;
}
