// Per-user-agent robots.txt parsing for the AI-crawler check.
//
// The old check was a flat regex over the whole file: it reported "AI bots
// blocked" whenever an AI user-agent appeared ANYWHERE in robots.txt and a
// "Disallow: /" appeared ANYWHERE else - even in a different user-agent's
// block, and even when the disallow was a path like /admin. That put a
// factually false claim in front of prospects (e.g. a file that blocks only
// Bing at root, plus a GPTBot block disallowing /admin, was reported as
// "explicitly blocking AI crawlers").
//
// This parser groups directives by user-agent block the way crawlers do
// (RFC 9309): consecutive User-agent lines form a group; the Disallow/Allow
// lines that follow apply to that group until the next group starts. A bot is
// considered blocked only when the group that actually applies to it
// disallows the root path.

const AI_BOTS = ['gptbot', 'google-extended', 'perplexitybot', 'claudebot', 'chatgpt-user'] as const;

export type AiBot = (typeof AI_BOTS)[number];

interface RobotsGroup {
  agents: string[];
  disallows: string[];
  allows: string[];
}

function parseGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  // True while we are still collecting consecutive User-agent lines for the
  // current group; a directive line flips it so the NEXT User-agent line
  // starts a fresh group.
  let collectingAgents = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      if (!collectingAgents) {
        current = { agents: [], disallows: [], allows: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current!.agents.push(value.toLowerCase());
    } else if (current) {
      collectingAgents = false;
      if (field === 'disallow') current.disallows.push(value);
      else if (field === 'allow') current.allows.push(value);
    }
  }
  return groups;
}

// Whether a group's rules block the entire site. Only a root disallow counts:
// "Disallow: /admin" or "Disallow: /private/" is normal hygiene, not a block.
// An explicit root Allow in the same group wins back access.
function blocksRoot(group: RobotsGroup): boolean {
  const disallowsRoot = group.disallows.some((d) => d === '/');
  const allowsRoot = group.allows.some((a) => a === '/');
  return disallowsRoot && !allowsRoot;
}

export interface AiBlockResult {
  blocked: boolean;
  // The AI crawlers that are blocked at root, for the evidence line.
  blockedBots: string[];
  // True when the block comes from a blanket "User-agent: *" rule rather than
  // a rule naming the AI crawler - phrased differently in the memo.
  viaWildcardOnly: boolean;
}

// Per RFC 9309, the most specific matching group wins: a group that names the
// bot explicitly overrides the "*" group entirely.
export function checkAiBotsBlocked(robotsTxt: string): AiBlockResult {
  const groups = parseGroups(robotsTxt);
  const wildcardGroups = groups.filter((g) => g.agents.includes('*'));

  const blockedBots: string[] = [];
  let anyExplicit = false;

  for (const bot of AI_BOTS) {
    const explicitGroups = groups.filter((g) => g.agents.some((a) => a === bot));
    const applicable = explicitGroups.length > 0 ? explicitGroups : wildcardGroups;
    if (applicable.some(blocksRoot)) {
      blockedBots.push(bot);
      if (explicitGroups.length > 0) anyExplicit = true;
    }
  }

  return {
    blocked: blockedBots.length > 0,
    blockedBots,
    viaWildcardOnly: blockedBots.length > 0 && !anyExplicit,
  };
}
