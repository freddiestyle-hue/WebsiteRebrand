# Rivett · Voice & Mark Rules

A short field guide. The system already encodes the look. This file pins the things that aren't in CSS.

---

## The dot

The dot after **rivett·** is the brand's only ornament. Use it sparingly and never decoratively.

- Always rendered in `--accent` (#8FBF3F), never the deep variant.
- Always trailing the wordmark, never leading.
- Always a perfect circle. Never replaced with a bullet, en-dot, or middot character.
- One per page in the wordmark. The stamp dot (•) before mono labels is the only allowed echo.
- Never animated, never stroked, never gradiented.

## Wordmark

- Lowercase `rivett`, Inter Tight 700, letter-spacing −0.05em.
- Set in `--ink` on light surfaces, `--paper` on dark — never coloured.
- Minimum size: 14px (footer use). Below 14px use the R-peak mark instead.
- Clearspace: 0.5 cap-height on all sides.
- The dot must scale with the wordmark; never set independently.

## Voice

The brand reads like a senior operator writing late at night. Not a marketer.

**Do:**
- Short declarative sentences. One idea per sentence.
- Specific numbers (`$10M`, `30 markets`, `40–60 min`). Never round to "millions" when you have the number.
- Concrete verbs (`run`, `ship`, `instrument`, `decline`). Never `leverage`, `unlock`, `empower`.
- Quoted italic for the emotional beat: *"This is not an AI story."* Newsreader italic, ink-dim.
- The em-dash is replaced by the period. Two short sentences > one long one.

**Don't:**
- No emoji. Ever. Not in copy, not in headers, not in CTAs.
- No exclamation marks except inside a quote.
- No em-dashes (—). The closest acceptable mark is the en-dash (–) in numeric ranges only: `40–60 min`.
- No "AI-powered", "next-gen", "supercharged", "10x".
- No question marks in headlines unless the section is genuinely a question, in which case use them generously (the FAQ pattern).

## Italic

Newsreader italic is the brand's whisper. It carries the second clause of a thought.

- Pair with a roman first clause: `Three more` *`in the same key.`*
- Always `--ink-dim` on light, `--on-ink-italic` on dark. Never `--ink`.
- Never set a whole sentence in italic. The italic is the turn, not the statement.
- Never bold + italic in the same span.

## Numbers

- Roman in body copy, mono in callouts and stats.
- Mixed units use italic Newsreader for the unit: `40–60` *`min`*.
- En-dash for ranges, never hyphen: `40–60`, never `40-60`.
- No thousands separators below 10,000. `$10M` not `$10,000,000`.

## Stamps (mono labels)

- Always uppercase. Always letter-spacing 0.22em.
- Always preceded by the 8px green dot (`.stamp::before`).
- Use for: section headers ("Frequently asked"), meta strips, related tags, end-CTA price tag.
- Never use as a button label.
- Maximum two words after the dot. Three is too many.

## CTAs

The system has exactly three CTAs in rotation:

1. `Run the Revenue MRI →` — solid ink button, the cold-traffic primary action.
2. `Book diagnostic →` — solid ink or outline button, the warm-traffic commercial action.
3. `← Field Notes` — text-only crumb, the back-out.

`Read more Field Notes` can appear as a secondary editorial action. If a page needs more than those, the page is doing too much.
