---
tag: Insights
title: "What 97 million MCP installs actually means for your marketing stack."
date: 2026-04-07
lastModified: 2026-04-16
slug: what-97-million-mcp-installs-means
excerpt: "MCP is infrastructure. The real value now shifts to who builds the best agents on top. Here's what it means for your marketing operations."
metaDescription: "Model Context Protocol (MCP) is now the standard infrastructure for AI agents. Learn what this means for your marketing stack and agentic operations."
readTime: 5
---

**TL;DR:** MCP has won as the universal standard for AI agent connectivity - 97 million installs, adopted by Microsoft, Google, Amazon, and OpenAI. The infrastructure question is settled. What matters now is agent quality. The competitive advantage no longer lives in which model you use. It lives in how precisely your agents are designed for your specific market.

97 million installs.

That is how many times Model Context Protocol (MCP) has been installed across platforms, according to Anthropic. Microsoft, Google, Amazon, OpenAI - all compatible. All using the same standard.

Infrastructure is decided.

For the past three years, the question was: what is the right protocol for connecting AI agents to your tools and data? How do we standardise how agents access context?

That question is answered. MCP is the standard. Everyone uses it.

What matters now is what you build on top.

## What Is MCP and Why Does It Matter?

MCP is not exciting. It is boring. It is infrastructure.

Think of it like HTTP for AI. HTTP is boring. Nobody talks about HTTP at conferences. Nobody writes thought leadership about HTTP. But HTTP enabled the entire web.

MCP is the same. It is a standard protocol for connecting AI agents to data and tools. Before MCP, you needed custom integrations for each agent to each tool. Custom code to connect Claude to your CRM. Different custom code to connect GPT-4 to your CRM. All of it fragile. All of it expensive to maintain.

After MCP, you connect once. The protocol handles the rest. Your CRM exposes an MCP server. Every agent that speaks MCP - Claude, GPT-4, Gemini, whatever comes next - can connect to it.

Standard. Portable. Reusable.

## Why Do 97 Million Installs Signal a Settled Standard?

The number matters because it signals adoption - not experimentation.

Microsoft built MCP into Copilot. Google built it into Vertex. Amazon built it into Bedrock. OpenAI made their agents MCP-compatible.

When the four largest AI infrastructure providers all ship to the same standard, the standard has won. This is not a prediction. It is a current state. MCP is infrastructure today, in the same way TCP/IP is infrastructure. You do not debate it. You build on top of it.

## What Changes Now That MCP Has Won?

Before MCP won: the competitive question was "what stack do we build on?" Claude vs GPT-4 vs Gemini. Which model, which platform, which integration layer.

After MCP won: that question is mostly irrelevant. All the major models speak MCP. Switching providers is a configuration change, not a rebuild.

The competitive question now is: who builds the best agents?

Not who has the best model. The models are commodities. Roughly equivalent. All improving fast.

The competitive advantage now lives in agent design - the specific logic of how you detect signals, enrich leads, prioritise outreach, run approval gates, and close feedback loops. That logic is yours. That is defensible. That is the moat.

## What Does MCP Mean for Your Marketing Stack?

Your marketing stack probably looks like this today:

- CRM (HubSpot, Salesforce, Pipedrive)
- Email platform (Klaviyo, Mailchimp, HubSpot again)
- Paid ads (Google, Meta, LinkedIn)
- Analytics (GA4, Mixpanel, Segment)
- Automation glue (Zapier, Make, custom code)

Each piece is connected through fragile custom integrations. Zapier flows that break. Webhooks that stop firing. Engineers spending time maintaining glue instead of building.

With MCP as standard, your stack architecture flattens:

- Each platform exposes an MCP server (HubSpot has one. Salesforce is building one. The community is building the rest.)
- Your agents connect to all of them through MCP
- Agents make decisions, take actions, log results back
- No custom integrations. No Zapier. The agent is the integration layer.

## Where Does the Competitive Advantage Live Now?

The defensible advantage is agent design - not the model, not the integration layer.

Generic CRM agent: connects to HubSpot, reads contacts, writes notes.

Sharp SDR agent: connects to HubSpot, reads contacts and deals, enriches each lead against 12 data sources, scores them against your closed-won patterns, writes personalised outreach specific to each prospect's context, queues for human approval, logs outcomes back to HubSpot, feeds close rates back to ad platforms.

Both use MCP. One is a feature. One is a moat.

For a concrete example of what a purpose-built agent looks like in practice, see [why we built our own SDR agent before selling it](/blog/why-we-built-our-own-sdr-agent).

## Who Wins When MCP Is the Standard?

The companies that win are not the ones with the biggest AI budgets. They are the ones who build domain-specific agents fastest.

An agency with sharp outbound agents will out-acquire a competitor with a generic CRM.

A SaaS company with a tight customer success agent will retain better than one relying on manual CSMs.

A marketing team with a closed-loop ad optimisation agent will get better ROAS than one running campaigns manually.

In every case, the advantage is not the model. It is the agent. The logic, the signals, the rules, the feedback loops - all built for your specific market and your specific playbook.

## What Should You Build First?

Start with your highest-volume, highest-cost manual process.

For most B2B companies, that is outbound. SDRs sorting through leads. Manually enriching. Writing cold emails one at a time.

Build an agent to own that process: signal detection, enrichment, personalised outreach, human approval gate. Start with one process. Run it for 90 days. Measure the output. Then scale.

The infrastructure is ready. The models are ready. The only variable is execution.

## FAQ

**Do we need to understand MCP to build agents?**
No. You need to know it exists and that any agent you build today should be MCP-compatible. The implementation details are handled by the SDKs.

**Which MCP servers are already available?**
HubSpot, GitHub, Slack, Linear, PostgreSQL, and dozens more have community-maintained MCP servers. Anthropic maintains an official registry. Most major SaaS platforms are building official servers now.

**Does this mean our current tools are obsolete?**
No. It means your current tools become agent-readable. Your CRM becomes a data layer your agents can read and write. Your analytics become inputs your agents can act on. The tools stay. The workflows get replaced.

**How do we stay current as MCP evolves?**
Build on the standard, not on a specific implementation. Use MCP-compatible agents. Swap models as they improve. Focus on your agent logic - that is the part that does not change with every model release.
