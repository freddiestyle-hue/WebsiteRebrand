---
title: "Anthropic Hit 30% Enterprise Spend. Not Because Claude Is Smarter."
date: 2026-04-22
lastModified: 2026-04-22
slug: anthropic-30-percent-not-smarter
tag: Insights
excerpt: "The FT says Anthropic is at 30% of enterprise AI spend, OpenAI at 35%, and the field is still wide open. The companies writing those cheques did not pick their vendor by running benchmarks."
metaDescription: "FT data: Anthropic at 30% enterprise AI spend, OpenAI at 35%. The model war ended. Distribution won. Most operators optimize for the wrong variable."
readTime: 4
---

**TL;DR:** New Financial Times data shows Anthropic at 30% of US enterprise AI spend, OpenAI at 35%, "any AI" adoption past 50%. The companies writing those cheques did not pick their vendor by running benchmarks. They picked whichever model was already embedded in the tools their teams used daily. The model war ended. You just kept fighting it.

You had a browser tab open this morning comparing Claude Opus 4.7 and GPT-5.4 on SWE-bench. Maybe CursorBench.

Meanwhile, Financial Times data published this week says Anthropic has crossed 30% of US enterprise AI spend. The companies spending those billions did not pick their vendor by reading benchmark charts.

Here is the question worth sitting with: which AI model is already open on every laptop at your company this morning? That is the one winning at your company. The benchmark tab is a hobby, not a decision.

## What Did the FT Data Actually Show?

"Any AI" adoption passed 50% in US businesses. OpenAI leads enterprise spend at ~35%. Anthropic is the fastest riser at ~30%. Google, xAI, and DeepSeek are still scrambling for paid penetration.

Translation: the question stopped being "are companies buying AI?" It is now "which AI got embedded in which workflow?" OpenAI owns chat (ChatGPT on every screen). Anthropic owns code (Claude Code in every terminal). Microsoft owns Office tasks via Copilot. Everyone else is fighting for distribution they do not have yet.

This is not a model war. It is a distribution war dressed up as a model war.

## Why Did Anthropic Hit 30% So Fast?

Three mechanisms, in order of impact. None of them are about model capability.

**One.** Claude Code became the default coding tool for teams that churned off Copilot in 2024-2025. Once it was in the terminal, procurement added Claude Pro seats, then Claude API, then Claude Managed Agents. Expansion follows installation.

**Two.** Anthropic's enterprise safety positioning matched the compliance reviewer who actually signs the contract. "Refuses harder things" reads as "less risk in legal review." That is why big-bank procurement moved faster on Claude than on competitors with better raw benchmarks.

**Three.** MCP. Anthropic shipped the protocol in 2024, then let the ecosystem do the integration work. Every MCP-compatible tool is Claude-native distribution by default. Most buyers never made an explicit Claude decision. They bought a tool that shipped with Claude inside.

Microsoft used the same playbook to win with Office. Not best product. Best installed base.

## Why Does Distribution Beat Capability in Enterprise?

Because capability differences are invisible at the workflow level. Most operators cannot tell the difference between Claude Opus, GPT-5.4, and Gemini 3.1 on their daily tasks. The benchmark gaps are real but only matter for roughly 5% of use cases. The other 95% come down to: which model is already open.

Microsoft won with Office because Excel was on the machine. Salesforce won with CRM because reps logged in daily. Slack won with comms because the channels were already there. AI works the same way. Whichever model is embedded in the tool your team uses most wins that seat. This is the same operator pattern we broke down in [the five-variable framework we published this week](/blog/claude-vs-open-source-five-variable-framework). Distribution is not variable six. It is how variables one through three get decided in practice.

## What Should You Optimize For Instead?

Ship velocity with the vendor your team already uses. Not the one that topped a benchmark last Tuesday.

If your engineers live in Claude Code, build agents on Claude. If your ops team runs ChatGPT Enterprise, build agents there. Switching vendors to chase a three-point benchmark gain is worth it at 10 million agent runs per month. It is waste at 10,000.

The FT data is telling you the market already decided this. You can spend Q2 comparing models or you can spend it shipping.

## FAQ

**Does this mean benchmarks do not matter?**
They matter, but not for the decision you are making. Benchmarks matter when you are building a product that relies on a specific capability (advanced reasoning, long-context retrieval, vision). They do not matter when you are picking which vendor to run marketing agents on. For 95% of operator use cases, the top-three models are interchangeable on output quality.

**If OpenAI leads at 35%, should I default to ChatGPT?**
Probably yes, unless your team already runs Claude Code or another Anthropic-first tool. The correct default is "whichever vendor my team already opens daily." OpenAI has the lead because that answer is ChatGPT for more teams than any other answer. It is not because GPT is smarter.

**How does this apply if my team uses both?**
Most teams do. Pick the vendor embedded in the workflow you are automating first. SDR team on HubSpot and ChatGPT? Build SDR agents on OpenAI. Engineers in Claude Code? Build developer agents on Claude. Mixed stacks are normal. Single-vendor purity is a consultant concern, not an operator one.

**What about verticals where capability is life-or-death?**
Medicine, law, finance, defense, certain coding workloads. Here, capability gaps matter and benchmarks are relevant. But even in those verticals, the winning vendor is the one that got into the workflow first, not the one with the best paper. GPT-Rosalind is winning biotech not because of its BixBench score. Because Amgen, Moderna, and UCSF already integrated it.

**Is this going to change in 12 months?**
The percentages will shift. The dynamic will not. Distribution-first wins in enterprise software have been stable since the 1990s. The AI vendor that wins 2027 will be the one embedded in the most workflows on January 1 of that year, not the one with the highest benchmark in December.
