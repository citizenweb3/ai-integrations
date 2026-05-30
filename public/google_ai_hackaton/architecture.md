# CitizenWeb3 AI Operations Platform — Architecture

> Four production agents on one Google Cloud project, one Vertex AI backbone.  
> Operating principle: **the model proposes → the pipeline verifies → the operator approves.**

---

```mermaid
flowchart TB
    subgraph GCP["☁️ Google Cloud Project · vertexLocation: global · ADC-only · GOOGLE_API_KEY rejected at startup"]

        subgraph VX["Vertex AI"]
            GEN["Gemini Generation\ngemini-3.5-flash · gemini-2.5-flash\ngemini-2.5-flash-lite · gemini-3-flash-preview"]
            EMB["Gemini Embeddings\ngemini-embedding-001 768d — ValidatorInfo + Logos\ngemini-embedding-2 1536d global — BizDev"]
            GRD["Vertex Grounding\ngoogle_search\nisolated tool — not shared"]
        end

        AIDA["🤖 Aida · Python ADK 2.1 · Telegram Community\n──────────────────────────────\n4-role topology: router → reactive → reply → verification\n3-Gate pipeline · 10-min proactive scanner\nskipped_phase2_no_tools hard gate enforced in code"]

        BIZ["📧 BizDev · Python ADK 2.1 · Outbound Sales Loop\n──────────────────────────────\n10 stages: research → contact discovery → cold/warm draft\n→ operator revision → validate_claims → RFC822 send\n→ 10-class reply classifier\nresearch_quality_gate reviews without calling tools\nInternal RAG: rag_embeddings pgvector 1536d"]

        VI["📊 ValidatorInfo · Vercel AI SDK · validatorinfo.com\n━━━━━━━━━━━━━━━━━━ KNOWLEDGE HUB ━━━━━━━━━━━━━━━━━━\n5 AI features: page-context chat · proposal summaries\npodcast summaries · 7-topic host-meta corpus · explain-page\n/api/rag/search endpoint · read-only on-chain Postgres\npodcast_chunks + host_meta pgvector 768d"]

        LOGOS["🔍 Logos · Vercel AI SDK · Chain Onboarding\n──────────────────────────────\n4-step retrieval: query rewrite → embed\n→ HNSW + GIN tsvector hybrid RRF\n→ Zod-validated LLM rerank\nlogos_chunks pgvector 768d · independent silo"]

    end

    TG(["Telegram\nBot API + Telethon + aiogram"])
    RS(["Resend\nEmail delivery + inbound webhook"])

    AIDA -->|"query_validatorinfo + search_rag ✅ live"| VI
    BIZ -. "roadmap" .-> VI

    AIDA -->|"isolated web_research sub-agent"| GRD
    BIZ -->|"research stages only"| GRD

    AIDA <--> TG
    BIZ <--> TG
    BIZ <--> RS

    AIDA & BIZ & VI & LOGOS --> GEN
    VI & LOGOS & BIZ --> EMB
```

---

## Surfaces at a glance

| Surface | Runtime | Key mechanism |
|---|---|---|
| **Aida** | Python ADK 2.1 · 4 roles | `len(tool_calls2) == 0 → skipped_phase2_no_tools` hard gate |
| **BizDev** | Python ADK 2.1 · 10 stages | `research_quality_gate` reviews without searching; `validate_claims` maps claims to `factId` |
| **ValidatorInfo** | Vercel AI SDK + `@ai-sdk/google-vertex 4.0.128` | Knowledge hub: `/api/rag/search` + read-only on-chain Postgres grounding Aida today, BizDev on roadmap |
| **Logos** | Vercel AI SDK + `@ai-sdk/google-vertex 4.0.128` | HNSW + GIN tsvector hybrid search via RRF + Zod-validated LLM rerank |

## Model registry

| Model | Where used |
|---|---|
| `gemini-2.5-flash-lite` | Aida router |
| `gemini-3.5-flash` | Aida reactive/reply/verification · BizDev all stages · ValidatorInfo chat |
| `gemini-2.5-flash` | Logos query rewrite + LLM rerank |
| `gemini-3-flash-preview` | Logos answer generation |
| `gemini-embedding-001` 768d | ValidatorInfo + Logos vector stores |
| `gemini-embedding-2` 1536d global | BizDev internal RAG (asymmetric task types) |

## Repositories

- [`citizenweb3/ai-integrations`](https://github.com/citizenweb3/ai-integrations) — branches: [`telegram-growth-agent-vertex`](https://github.com/citizenweb3/ai-integrations/tree/telegram-growth-agent-vertex) (Aida) · [`bizdev-email-agent`](https://github.com/citizenweb3/ai-integrations/tree/bizdev-email-agent) (BizDev) · [`logos-onboarding-assistant`](https://github.com/citizenweb3/ai-integrations/tree/logos-onboarding-assistant) (Logos)
- [`citizenweb3/validatorinfo`](https://github.com/citizenweb3/validatorinfo) — ValidatorInfo
