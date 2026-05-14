/* global React */
// Icon — 24-grid, 1.6 stroke, square caps, mitre joins. The accent dot rule is encoded:
// each icon's `dot` prop / inline circle uses --accent.
// Usage: <Icon name="diagnostic" size={36} />

const ICONS = {
  // Core (06)
  'diagnostic': <><circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 L20 20"/><circle className="dot" cx="11" cy="11" r="1.4"/></>,
  'pipeline':   <><path d="M3 7 H17 a3 3 0 0 1 0 6 H7 a3 3 0 0 0 0 6 H21"/><circle className="dot" cx="3" cy="7" r="1.6"/></>,
  'signal':     <><path d="M3 18 L9 12 L13 16 L21 6"/><circle className="dot" cx="21" cy="6" r="1.6"/></>,
  'cadence':    <><circle cx="12" cy="12" r="9"/><path d="M12 6 V12 L17 14"/></>,
  'stack':      <><path d="M3 7 L12 3 L21 7 L12 11 Z"/><path d="M3 12 L12 16 L21 12"/><path d="M3 17 L12 21 L21 17"/></>,
  'operator':   <><circle cx="12" cy="9" r="4"/><path d="M4 21 a8 8 0 0 1 16 0"/></>,
  // Functional (06)
  'approval':   <><rect x="4" y="4" width="16" height="16"/><path d="M8 12 L11 15 L17 9"/></>,
  'decline':    <><circle cx="12" cy="12" r="9"/><path d="M8 8 L16 16 M16 8 L8 16"/></>,
  'halt':       <><rect x="5" y="5" width="14" height="14"/><path d="M9 12 H15"/></>,
  'external':   <><path d="M14 4 L20 4 L20 10 M20 4 L11 13 M5 12 V19 H19 V14"/></>,
  'arrow':      <><path d="M5 12 H19 M13 6 L19 12 L13 18"/></>,
  'confirm':    <><circle cx="12" cy="12" r="9"/><path d="M9 12 L11 14 L15 10"/><circle className="dot" cx="12" cy="12" r="1.2"/></>,
  // Editorial (06)
  'memo':       <><path d="M5 3 H15 L19 7 V21 H5 Z"/><path d="M8 11 H16 M8 15 H16 M8 19 H13"/></>,
  'outreach':   <><rect x="3" y="6" width="18" height="13"/><path d="M3 6 L12 14 L21 6"/></>,
  'field-note': <><path d="M6 4 H18 L20 6 V20 H4 V6 Z"/><path d="M8 10 H16 M8 14 H16"/><circle className="dot" cx="6" cy="4" r="1.4"/></>,
  'archive':    <><path d="M5 5 H10 V19 H5 Z M14 5 H19 V19 H14 Z"/></>,
  'type':       <><path d="M4 9 L4 5 L20 5 L20 9 M12 5 V19 M8 19 H16"/></>,
  'contents':   <><path d="M5 5 L19 5 M5 12 L19 12 M5 19 L13 19"/></>,
  // Metric (06)
  'numbers':    <><path d="M3 21 V11 H7 V21 Z M10 21 V5 H14 V21 Z M17 21 V15 H21 V21 Z"/></>,
  'share':      <><circle cx="12" cy="12" r="9"/><path d="M12 12 L12 3 M12 12 L21 12"/><circle className="dot" cx="12" cy="12" r="1.2"/></>,
  'curve':      <><path d="M3 17 Q9 17 12 11 T21 5"/><path d="M3 21 H21"/><circle className="dot" cx="21" cy="5" r="1.6"/></>,
  'cohort':     <><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></>,
  'vital':      <><path d="M3 12 H8 L10 6 L14 18 L16 12 H21"/><circle className="dot" cx="14" cy="18" r="1.4"/></>,
  'flag':       <><path d="M4 20 L12 4 L20 20 Z"/><path d="M12 11 V15"/><circle className="fill" cx="12" cy="17.5" r="0.8"/></>,
};

function Icon({ name, size = 24, className = '', ...rest }) {
  const inner = ICONS[name];
  if (!inner) {
    console.warn('[rivett] unknown icon:', name);
    return null;
  }
  return (
    <svg
      className={`ic ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={name}
      {...rest}
    >
      {inner}
    </svg>
  );
}

Object.assign(window, { Icon, ICONS });
