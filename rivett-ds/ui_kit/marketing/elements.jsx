/* global React */
// Atomic brand elements: Wordmark, Stamp, Button.
// These appear on every page. Get them right; the rest follows.

// Wordmark — `rivett·`. Inter Tight 700, lowercase, -0.05em tracking, accent dot trailing.
// The dot is a `<span>` so it scales with em.
function Wordmark({ size = 'md', inverse = false, href = '#', ...rest }) {
  const cls = [
    'wm',
    size === 'sm' && 'wm--sm',
    size === 'lg' && 'wm--lg',
    inverse && 'wm--inv',
  ].filter(Boolean).join(' ');
  return (
    <a className={cls} href={href} {...rest}>
      rivett<span className="dot" aria-hidden="true"></span>
    </a>
  );
}

// Stamp — the mono label. Always uppercase, always preceded by an 8-px accent dot.
// Two-word maximum after the dot.
function Stamp({ children, variant = 'default', as: As = 'span', ...rest }) {
  const cls = [
    'stamp',
    variant === 'neutral' && 'stamp--neutral',
    variant === 'on-ink' && 'stamp--on-ink',
  ].filter(Boolean).join(' ');
  return <As className={cls} {...rest}>{children}</As>;
}

// Button — three variants. Never four.
// Primary (solid ink), Secondary (outline), Inverse (paper on ink).
// Optional trailing arrow.
function Button({
  children,
  variant = 'secondary',
  size = 'md',
  arrow = false,
  as: As = 'button',
  ...rest
}) {
  const cls = [
    'btn',
    variant === 'solid' && 'btn--solid',
    variant === 'inverse' && 'btn--inv',
    size === 'sm' && 'btn--sm',
  ].filter(Boolean).join(' ');
  return (
    <As className={cls} {...rest}>
      {children}
      {arrow && <span aria-hidden="true">→</span>}
    </As>
  );
}

Object.assign(window, { Wordmark, Stamp, Button });
