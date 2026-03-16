# Globula — MLM CRM: Diagrams

---

## 1. Architecture Overview

```mermaid
graph TD
    TG[Telegram] --> BOT[Grammy Bot - Dispatcher]
    BOT --> CLAUDE[Claude Code - Brain]
    CLAUDE --> RAG[(RAG Knowledge Base)]
    CLAUDE --> TOOLS[yarn commands - Tools]
    TOOLS --> DB[(PostgreSQL)]
    CLAUDE --> CRM[CRM Web Panel]
    CRM --> DB
    HUMAN[Admin] --> CRM
    HUMAN --> RAG
```

---

## 2. Three Agents

```mermaid
graph TD
    subgraph Community Bot
        CB1[Telegram message] --> CB2[AI responds]
        CB2 --> CB3[Register / Onboard / Follow-up]
    end

    subgraph CRM Agent
        CA1[Daily cron] --> CA2[Analyze network]
        CA2 --> CA3[Reports + recommendations]
    end

    subgraph Accountant
        AC1[Cron or manual trigger] --> AC2[Calculate commissions]
        AC2 --> AC3[Prepare payment batch]
        AC3 --> AC4[Human confirms]
    end
```

---

## 3. Registration Flow

```mermaid
graph TD
    A[Distributor shares referral link] --> B[New user opens Telegram bot]
    B --> C[Bot asks name + contact]
    C --> D[Bot creates account in DB]
    D --> E[Links to parent in referral tree]
    E --> F[Bot starts onboarding]
    F --> G[User is active distributor]
```

---

## 4. Lead Funnel

```mermaid
graph TD
    A[New lead] --> B[Contacted]
    B --> C[Interested]
    C --> D[Registered]
    D --> E[Active distributor]
```

---

## 5. Commission Calculation

```mermaid
graph TD
    A[Participant makes a purchase] --> B[System walks up the tree]
    B --> C[Level 1 parent: X% commission]
    B --> D[Level 2 parent: Y% commission]
    B --> E[Level 3 parent: Z% commission]
    C --> F[Commissions saved to DB]
    D --> F
    E --> F
    F --> G[Accountant agent collects batch]
    G --> H[Human confirms payment]
    H --> I[Money sent]
```

---

## 6. Payment Security - Multisig

```mermaid
graph LR
    A[Agent calculates] --> B[Agent prepares batch]
    B --> C[Human reviews in CRM panel]
    C --> D{Confirm?}
    D -->|Yes| E[Payment processed]
    D -->|No| F[Agent recalculates]
```

---

## 7. Telegram Bot - Two Modes

```mermaid
graph TD
    TG[Telegram]

    TG --> CHANNEL[Channel: news + content]
    TG --> DM[Direct messages: sales funnel]

    CHANNEL --> POST[CRM Agent posts updates]
    CHANNEL --> NEWS[Product announcements]

    DM --> REG[Registration]
    DM --> ONBOARD[Onboarding]
    DM --> FOLLOWUP[Follow-up inactive users]
    DM --> FAQ[Answer questions]
```

---

## 8. RAG Knowledge Base

```mermaid
graph TD
    A[Owner provides FAQ + materials] --> B[Indexed into vector DB]
    C[User asks question] --> D[Search relevant answers in RAG]
    D --> E{Found?}
    E -->|Yes| F[AI answers based on real data]
    E -->|No| G[Bot says: I dont know, forwarding to manager]
    F --> H[Bot detects new patterns]
    H --> I[Suggests additions to knowledge base]
    I --> A
```

---

## 9. Agent-First Pattern

```mermaid
graph TD
    EVENT[Event: TG message or Cron] --> DISPATCHER[Grammy Bot - Dispatcher]
    DISPATCHER --> SESSION[Claude Code session]
    SESSION --> DECIDE[AI decides what to do]
    DECIDE --> TOOL1[yarn crm - manage users]
    DECIDE --> TOOL2[yarn leads - manage funnel]
    DECIDE --> TOOL3[yarn pay - prepare payments]
    TOOL1 --> DB[(PostgreSQL)]
    TOOL2 --> DB
    TOOL3 --> DB
```

---

## 9. Three Options

### Option A: MVP

```mermaid
graph LR
    A[Telegram Bot] --> B[Registration + FAQ]
    B --> C[CRM Panel]
    C --> D[User list + Tree view]
```

### Option B: With AI automation

```mermaid
graph LR
    A[AI Telegram Bot] --> B[Lead qualification + Follow-up]
    B --> C[CRM Panel + Analytics]
    C --> D[Auto commission calculation]
    D --> E[Human confirms payment]
```

### Option C: Full system

```mermaid
graph TD
    A[AI Telegram Bot] --> B[Adaptive onboarding]
    C[CRM Agent] --> D[Network graph analysis]
    E[Accountant] --> F[Auto payments with multisig]
    D --> G[AI recommendations]
    G --> A
```
