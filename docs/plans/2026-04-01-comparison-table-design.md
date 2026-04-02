# AI Agents Comparison Table — Design Document

**Дата**: 2026-04-01
**Страница**: ai-integrations landing, ветка ai-landing-dev
**Аудитория**: Основатели и PM, которые решают как добавить AI агентов в свой бизнес

---

## Структура: 4 колонки

| Column | What it represents | Examples |
|--------|-------------------|----------|
| **Our Agent Factory** | Self-hosted agent platform + implementation services | Claude Code, Docker, GitHub Actions, MCP, custom agents |
| **DIY Frameworks** | Open-source libraries — build everything yourself | CrewAI, LangGraph (LangChain), AutoGen (Microsoft), OpenAI Agents SDK / Swarm |
| **Cloud Platforms** | Managed agent environments — pay per use | Anthropic Claude (Cowork/Computer Use), OpenClaw, Relevance AI |
| **No-Code Tools** | Visual automation builders | n8n, Dify, Make (Integromat), Zapier |

---

## 7 Parameters

### 1. Data Control

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| Full ownership. Runs on your infrastructure, your data never leaves your servers. You control access, encryption, and retention. | Full ownership if you deploy yourself. But you build and secure everything from scratch. | Provider stores your data on their cloud. Subject to their privacy policy, data processing terms, and jurisdiction. | Mixed. Workflows run on their cloud, data passes through their servers. Some offer self-hosted options (n8n) but with limited AI capabilities. |

### 2. Time to Production

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| Days to weeks. We handle architecture, deployment, and integration. You describe what you need, we deliver working agents. | Months. You need a dev team to design, build, test, and deploy. Every integration is custom code. | Hours to days for simple agents. Weeks when you hit platform limits and need workarounds. | Hours for basic automations. Breaks down when you need custom logic, complex chains, or domain-specific behavior. |

### 3. Total Cost

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| Project-based pricing. Infrastructure costs are predictable — your servers, your LLM keys. No per-seat fees, no usage surprises. | Low framework cost (open-source), but high team cost. You pay for developers to build, maintain, and debug. The framework is free, the engineering is not. | Per-token or per-seat pricing that scales with usage. Starts cheap, grows fast. Enterprise plans required for serious features. | Free or low entry. Paid tiers for volume, premium nodes, and AI steps. Costs compound when you chain multiple services together. |

### 4. Customization Depth

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| Unlimited. Agents built for your specific domain, data, and workflows. Custom tools, custom models, custom integrations. No platform constraints. | Unlimited in theory. You can build anything, but you build everything. Every custom feature is engineering time. | Limited by platform capabilities. Works great within their design patterns, painful when you need something they didn't anticipate. | Shallow. Pre-built nodes and templates. When your use case doesn't fit existing blocks, you're stuck or writing custom code anyway. |

### 5. Maintenance Burden

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| We handle it. Agent updates, model migrations, infrastructure monitoring, incident response. You focus on your business. | All on you. Framework updates break things, LLM API changes need code fixes, scaling issues need DevOps. Your team owns every layer. | Provider handles platform uptime, but you own prompt engineering, workflow logic, and debugging when agents misbehave. Limited visibility into what went wrong. | Platform maintains itself, but when an automation breaks at 2AM you're reading docs alone. Complex chains are hard to debug with visual tools. |

### 6. Integration with Existing Systems

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| Direct access. Agents connect to your databases, APIs, and internal tools through MCP and custom connectors. We build the bridge. | Full access if you code it. Every integration is a custom development project. Powerful but time-consuming. | Through platform plugins and marketplace. Wide selection for popular services, gaps for niche or internal tools. | Hundreds of pre-built connectors for SaaS products. Weak for custom APIs, internal databases, or anything not in their marketplace. |

### 7. Scalability

| Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|
| Scales with your infrastructure. Add agents, add servers. No vendor bottlenecks, no usage caps. CI/CD pipeline handles deployment of new agents automatically. | Scales if you engineer it. You design the architecture, manage containers, handle load balancing. No limits except your team's capacity. | Scales easily within platform limits. But costs grow linearly, and enterprise tiers gate critical features like higher rate limits and priority support. | Struggles beyond basic workflows. Complex multi-agent systems don't fit the visual builder paradigm. Performance degrades with chain complexity. |

---

## Summary One-Liners (for quick scanning)

| Parameter | Our Agent Factory | DIY Frameworks | Cloud Platforms | No-Code Tools |
|---|---|---|---|---|
| Data Control | Your servers, your data | Your responsibility | Their cloud, their terms | Mixed |
| Time to Production | Days to weeks | Months | Hours to weeks | Hours to days |
| Total Cost | Predictable project pricing | Free tools, expensive team | Starts cheap, grows fast | Low entry, compounds |
| Customization | Unlimited, no constraints | Unlimited, you build it all | Limited by platform | Shallow, template-based |
| Maintenance | We handle it | All on your team | Platform up, agents yours | Simple ok, complex nightmare |
| Integration | Direct to your systems | Code every connector | Plugin marketplace | SaaS connectors only |
| Scalability | Grows with your infra | If you engineered it right | Easy but expensive | Not for complex agents |
