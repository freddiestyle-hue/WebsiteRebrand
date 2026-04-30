---
tag: Engineering
title: "The anatomy of an AI agent: skeleton, heartbeat, soul, and memory."
date: 2026-04-08
lastModified: 2026-04-16
slug: anatomy-of-ai-agent
excerpt: "Most companies treat agents as black boxes. The best ones architect them like living systems. Here's how we think about it."
metaDescription: "How to architect AI agents like living systems. The skeleton, heartbeat, soul, and memory that separate good agents from exceptional ones."
readTime: 6
---

**TL;DR:** Agents are not scripts. They are systems. The best operators architect them across four layers - skeleton (identity and constraints), heartbeat (the continuous loop), soul (values under pressure), and memory (how they learn). Most companies skip this and write a prompt instead. That is why their agents break. Here is what each layer does and why all four are required.

Most companies approach AI agents wrong.

They write a prompt. They plug it into an API. They hope it works.

Then it breaks. Or it drifts. Or it does something unexpected. And they have no idea why because they never understood how the agent actually works.

The best operators - the ones building agentic systems that scale - think about agents differently. They do not think of an agent as a prompt. They think of it as an organism. A system with distinct parts, each with a specific job, all working together to accomplish something real.

This is how we architect at Rivett. And it is why our agents scale when others burn out.

## What Are the Four Layers Every Agent Needs?

An agent needs four things to function as a living system: skeleton, heartbeat, soul, and memory.

### 1. The Skeleton - Identity and Constraints

The skeleton is the agent's core self. What is it? What is it trying to do? What are its boundaries?

The skeleton defines:
- **Who the agent is** - "I am an SDR agent. My job is to find, enrich, and prioritise prospects."
- **What it is trying to optimise for** - "I optimise for quality of prospect, not volume. I would rather send 10 exceptional outreaches than 100 mediocre ones."
- **What it cannot do** - "I never send unsolicited email to people who have opted out. I never misrepresent who I am."

Without a skeleton, the agent is directionless. It chases whatever signal is loudest. With a skeleton, the agent has values. It makes decisions consistent with those values. It can be trusted.

### 2. The Heartbeat - The Loop That Keeps It Alive

An agent without a heartbeat is just a function you call when you need it. That is not an agent. That is a tool.

A real agent has a heartbeat. A pulse. A reason to keep moving without you telling it to.

The heartbeat is:
- **How often the agent wakes up** - "Every 15 minutes, check for new inbound leads. Enrich them. Score them. Surface them."
- **What it does when it wakes up** - "Check if there are new signals. Check if past decisions need revision. Check if I am still healthy."
- **How it knows if something is wrong** - "If I have not processed a lead in 2 hours, I alert. If my enrichment data is stale, I refresh."

Without a heartbeat, agents are reactive. They wait for you to ask them to do something. With a heartbeat, they are proactive. They notice problems before you do. They run continuously without supervision.

This is the difference between a tool and a system.

### 3. The Soul - Values Under Pressure

The soul is the agent's moral compass. It sounds abstract. It is the most important layer when things get hard.

The soul defines:
- **What actually matters** - "I care about building genuine relationships, not gaming metrics. I would rather have 3 real conversations than 30 bounces."
- **What the agent will never compromise on** - "I will not sacrifice accuracy for speed. I will not contact someone I am not sure about just to hit a number."
- **How the agent behaves under pressure** - "If I am behind on quota, I do not lower my standards. I work smarter or I escalate."

An agent without a soul will optimise for whatever metric you give it, even if it destroys the thing you actually care about. An agent with a soul stays aligned with your values even when metrics pull the other direction.

### 4. The Memory - How It Learns

An agent without memory is like a human with amnesia. It repeats the same mistakes. It never improves.

Memory has two parts:

**Short-term memory:** What happened in the last few hours? What did I try? What worked? This is how the agent learns from immediate feedback. You reject an outreach. The agent remembers: "This kind of prospect is not a fit."

**Long-term memory:** What patterns have I seen over months? What do my best prospects look like? After 6 months of outreaches, the agent knows your market better than any human on your team.

Without memory, agents are static. With it, they improve continuously.

## How Do These Four Layers Work Together?

The skeleton gives the agent direction. The heartbeat keeps it moving. The soul keeps it aligned. The memory makes it smarter.

Example: our SDR agent.

**Skeleton says:** "I find prospects who match our ideal customer profile and reach out with personalised messages."

**Heartbeat says:** "Every 15 minutes, check for new inbound. Enrich and score them. Surface to the SDR for approval."

**Soul says:** "I would rather have one real conversation than ten fake ones. I care about quality. I will never compromise signal for volume."

**Memory says:** "I have now enriched 50,000 prospects. I know that Series B SaaS companies with this tech stack close at 40%. I know the decision maker is the VP of Growth 95% of the time."

Now the agent is not just executing instructions. It is thinking. It is learning. It is making decisions grounded in experience and values.

## Why Do Most Companies Get This Wrong?

Most companies treat agents as black boxes. They fine-tune a prompt, run it, and hope for the best.

When something breaks, they have no idea why because they never understood the architecture. When the agent drifts, they cannot fix it because they do not know what to adjust. When they want to improve it, they have to start over.

The companies that win treat agents like living systems. They understand the skeleton, design the heartbeat, define the soul, and build the memory. This takes more upfront work. But it pays back massively.

Once you understand these four layers, the agent becomes predictable. Debuggable. Improvable. Trustworthy.

## How Do You Start Building an Agent the Right Way?

Define the layers before you write a single line of code.

**Step 1: Define the skeleton.** What is the agent trying to do? What are its constraints? Write it down. Be specific.

**Step 2: Design the heartbeat.** How often does it wake up? What does it check? What does it alert on?

**Step 3: Write the soul.** What does this agent care about? What will it never compromise on? Get abstract. Get real about values.

**Step 4: Build the memory.** What does the agent need to remember? Short-term patterns? Long-term market knowledge? Design the storage.

Do this before you write any code. Most teams skip these steps. They go straight to prompting. That is why their agents break.

## FAQ

**Do we need to be technical to understand this?**
No. Understanding the skeleton, heartbeat, soul, and memory does not require code. It requires systems thinking. If you can understand how a business operates, you can understand how an agent operates.

**Can we update the agent's soul without rebuilding it?**
Yes. The soul is the easiest part to change because it is abstract principles, not code. You can update what the agent cares about without touching anything else.

**What if the agent's memory gets too big?**
Archive old memories and keep recent ones active. Think of it like a human: you remember recent events vividly, distant events faintly. Agents work the same way.

**How often should we update the heartbeat?**
Depends on your use case. An SDR agent running every 15 minutes makes sense. A customer success agent running every day makes sense. Design the heartbeat for your specific workflow.

**Is this the same as prompt engineering?**
No. Prompt engineering is tuning the words you give the agent. This is understanding the system the agent operates within. You can have perfect prompts in a broken system. The system matters more.
