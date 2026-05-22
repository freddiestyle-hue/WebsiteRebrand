// Industry context for the teardown hero prompt.
//
// slug-to-icp.json maps each prospect's v3 slug to one of ten ICP keys, or to
// null when the prospect is off-ICP. icp-voice.json holds, per ICP, the
// operator voice line and the stat-backed known pains gathered during ICP
// research. buildIndustryContext joins the two into the INDUSTRY_CONTEXT block
// the hero prompt reads (buildHeroUserPrompt in hero-llm.ts), so the diagnosis
// is written against what that industry is actually living through.
//
// The v3 slug is domain-only (v3SlugFromDomain in slug.ts) - the same shape as
// the slug-to-icp.json keys - so the lookup is direct, with no random suffix
// to strip. Pass the endpoint's validated v3 slug (params.slug); the secret
// /audit/p/ slug variant carries a 16-char suffix and would never match.
//
// The block is background, not evidence. The framing line tells the model so;
// the hero's figures still come only from the prospect's own audit, and the
// grounding check in hero-grounding.ts stays the backstop.

import slugToIcp from './slug-to-icp.json';
import icpVoice from './icp-voice.json';

interface IcpVoiceEntry {
  label: string;
  voice_line: string;
  hooks: readonly { body: string }[];
}

const slugMap: Record<string, string | null> = slugToIcp;
const voiceMap: Record<string, IcpVoiceEntry> = icpVoice;

// Known-pain lines to include. Three is the full set per ICP in icp-voice.json
// today; the cap keeps the prompt compact if that file ever grows.
const MAX_PAINS = 3;

// Build the INDUSTRY_CONTEXT block for one prospect, or null when the prospect
// is off-ICP or absent from the map (the hero prompt then reads "Not available.").
export function buildIndustryContext(slug: string): string | null {
  const icpKey = slugMap[slug];
  if (!icpKey) return null;

  const icp = voiceMap[icpKey];
  if (!icp) return null;

  const pains = icp.hooks
    .slice(0, MAX_PAINS)
    .map((hook) => `- ${hook.body.trim()}`)
    .join('\n');

  return [
    `This prospect operates in ${icp.label}.`,
    '',
    `How operators in this space describe their reality: "${icp.voice_line.trim()}"`,
    '',
    "Known pressure points across this industry, as background for your diagnosis - not findings from this prospect's audit:",
    pains,
    '',
    "Use this to understand what this operator is likely living through. Every number in your hero must still come from this prospect's own audit.",
  ].join('\n');
}
