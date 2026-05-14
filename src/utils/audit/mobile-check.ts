// Mobile rendering inference from the homepage HTML we already fetched.
//
// We can't run a real mobile viewport in the audit window (would need a
// headless browser, 5+ seconds), but we can extract several signals from
// the HTML alone that strongly predict whether the page works on a phone:
//
//   - <meta name="viewport"> present and not zoom-disabled
//   - inline body/min font-size hints under 14px
//   - button/link size hints from inline styles
//
// Returns null if we have no HTML to inspect. Otherwise emits structured
// flags + a one-line commentary.

export interface MobileRenderingResult {
  viewportPresent: boolean;
  viewportZoomDisabled: boolean;
  smallFontHint: boolean;       // suspect <14px body text
  smallTapTargetHint: boolean;  // suspect tappable elements <44px
  commentary: string;
}

const VIEWPORT_RE = /<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i;

function extractViewport(html: string): { present: boolean; zoomDisabled: boolean } {
  const m = html.match(VIEWPORT_RE);
  if (!m) return { present: false, zoomDisabled: false };
  const content = m[1];
  const zoomDisabled =
    /user-scalable\s*=\s*(no|0)/i.test(content) ||
    /maximum-scale\s*=\s*1(?:\.0+)?(?!\d)/i.test(content);
  return { present: true, zoomDisabled };
}

function hasSmallFontHint(html: string): boolean {
  // Look for inline font-size declarations under 14px on body/p/text-like
  // elements. False positives possible (legitimate small captions), but in
  // practice this signal correlates with phone-hostile pages.
  const matches = html.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt)/gi) ?? [];
  for (const m of matches) {
    const size = parseFloat(m.replace(/[^0-9.]/g, ''));
    if (size && size < 12) return true;
  }
  return false;
}

function hasSmallTapTargetHint(html: string): boolean {
  // Look for inline width/height declarations on button-like elements under 40px.
  // Coarse — designers often use padding instead of fixed sizes.
  const buttonLike = html.match(
    /<(?:button|a)\b[^>]*style=["'][^"']*(?:width|height)\s*:\s*(\d+)\s*px[^"']*["']/gi,
  );
  if (!buttonLike) return false;
  for (const tag of buttonLike) {
    const m = tag.match(/(?:width|height)\s*:\s*(\d+)/i);
    const px = m ? parseInt(m[1], 10) : 0;
    if (px > 0 && px < 40) return true;
  }
  return false;
}

export function checkMobileFromHtml(html: string | null | undefined): MobileRenderingResult | null {
  if (!html) return null;
  const { present: viewportPresent, zoomDisabled } = extractViewport(html);
  const smallFontHint = hasSmallFontHint(html);
  const smallTapTargetHint = hasSmallTapTargetHint(html);

  const issues: string[] = [];
  if (!viewportPresent) {
    issues.push('no viewport meta (page renders desktop-sized on phones)');
  } else if (zoomDisabled) {
    issues.push('viewport blocks zoom (accessibility hit, no functional gain)');
  }
  if (smallFontHint) issues.push('font sizes under 12px detected');
  if (smallTapTargetHint) issues.push('button or link sizes under 40px detected');

  const commentary =
    issues.length === 0
      ? 'Viewport meta is correct. No obvious phone-hostile sizing in the markup.'
      : issues.join('; ') + '.';

  return {
    viewportPresent,
    viewportZoomDisabled: zoomDisabled,
    smallFontHint,
    smallTapTargetHint,
    commentary,
  };
}
