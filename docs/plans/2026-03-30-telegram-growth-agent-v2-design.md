# Telegram Growth Agent V2 — Design Document

**Проект**: CitizenWeb3
**Дата**: 2026-03-30
**Приоритет**: HIGH
**Brain tasks**: #68, #69
**Предыдущий дизайн**: 2026-03-28-telegram-growth-agent-design.md (v1, устарел)
**Ревизия**: v2.2 — production implementation spec

---

## Оглавление

1. [Цель и constraints](#цель)
2. [Ключевые решения](#ключевые-решения)
3. [Персона и Identity Policy](#персона)
4. [Архитектура](#архитектура)
5. [Data Flow](#data-flow)
6. [Response Lifecycle State Machine](#response-lifecycle)
7. [ValidatorInfo Integration](#validatorinfo-integration)
8. [CLAUDE.md для агента](#claudemd-для-агента)
9. [Content Safety Policy](#content-safety-policy)
10. [claude -p Runtime Resilience](#claude--p-runtime-resilience)
11. [aiogram Approval Bot](#aiogram-approval-bot)
12. [Anti-ban и Rate Limiting](#anti-ban)
13. [Group Profile Model](#group-profile-model)
14. [Proactive Scoring Model](#proactive-scoring-model)
15. [Database Schema](#database-schema)
16. [Retention Model](#retention-model)
17. [Observability](#observability)
18. [Security и Incident Response](#security)
19. [Failure Matrix](#failure-matrix)
20. [Operational Contract](#operational-contract)
21. [Rollout Governance](#rollout-governance)
22. [Cost Model](#cost-model)
23. [Метрики успеха](#метрики-успеха)
24. [Assumption Register](#assumption-register)
25. [Структура проекта](#структура-проекта)
26. [Docker](#docker)

---

## Цель

Автономный Telegram агент для CitizenWeb3. Вступает в Web3/staking чаты, участвует в беседах как эксперт с реальными данными от ValidatorInfo, мягко привлекает людей в канал CitizenWeb3 и на ValidatorInfo. **Собирает базу релевантных контактов** — людей, интересующихся staking и Web3 (воронка для CW3 сообщества).

## Constraints

- Один Telegram user аккаунт
- 50 групп максимум
- RU + EN (автоопределение)
- Мягкая стратегия — быть полезным, не спамить
- Все действия через approval

---

## Ключевые решения

| # | Вопрос | Решение | Причина |
|---|--------|---------|---------|
| 1 | LLM вызов | `claude -p` (subprocess) | Бесплатно через Max |
| 2 | Персона | CLAUDE.md в Docker image | claude CLI подхватывает автоматически из cwd |
| 3 | Контейнер | Один Docker (Python + Node.js) | Node.js нужен для claude CLI |
| 4 | Триггер ответов | Гибрид: keyword → сразу + proactive каждые 10 мин | Реактивность + coverage |
| 5 | Хранение | SQLite (WAL mode) + cleanup каждый час, retention 48ч | Лёгкий, достаточный для контекста |
| 6 | Модерация | Approval через aiogram bot (Python) | Один процесс, один язык, прямые вызовы |
| 7 | Bot framework | aiogram (Python) | Один event loop с Telethon, без IPC |
| 8 | Вступление в группы | Через approval | Агент предлагает, Иван одобряет |
| 9 | Промо CW3 | Только когда тема напрямую совпадает | Контекстуальный gate, не временной |
| 10 | Knowledge base | ValidatorInfo RAG API + DB через adapter layer | Реальные данные, не выдумки |

---

## Персона

**Имя**: Alex
**Роль**: Web3 энтузиаст, staking researcher, знает данные ValidatorInfo
**Тон**: знающий но не высокомерный, casual, задаёт вопросы
**Языки**: автопереключение RU/EN
**Знания**: APR по сетям, валидаторы, governance, подкаст CitizenWeb3

### Identity and Disclosure Policy

Alex — публичная persona реального аккаунта. Не отдельная фейковая личность. Аккаунт существует как участник Web3-сообщества, автоматизация помогает формулировать и отправлять ответы.

**Принцип**: Community member with automation. Старается не попадаться, но при прямом вопросе — честный короткий ответ, а не уклонение.

**Approved response на прямой вопрос**: «Я использую автоматизацию для мониторинга данных по стейкингу — помогает быть в курсе того, что происходит в сетях.»

| Ситуация | Действие |
|----------|----------|
| Никто не спрашивает | Работаем штатно |
| Косвенный вопрос «ты бот?» | Approved response (см. выше) — честно, коротко, без драмы |
| Прямое обвинение | Тот же approved response. Не оправдываться. Перейти к теме |
| Настойчивое давление после ответа | Прекратить участие в ветке |
| Публичное разоблачение с негативной реакцией | Группа на паузу, уведомить Ivan, не защищаться |

**Абсолютные запреты**: никогда не говорить «я не бот» / «I am human». Никогда не имитировать другого пользователя.

---

## Архитектура

```
┌──────────────────────────────────────────────────────────────┐
│                    Docker Container                           │
│                  (Python + Node.js)                           │
│                 Один asyncio event loop                       │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Telethon    │  │  claude -p   │  │  aiogram Bot      │  │
│  │  (listener)   │  │  (responder) │  │  (approval UI)    │  │
│  │  user account │  │  subprocess  │  │  bot account      │  │
│  └──────┬────────┘  └──────┬───────┘  └───────┬───────────┘  │
│         │                  │                   │              │
│  ┌──────▼──────────────────▼───────────────────▼──────────┐  │
│  │                      SQLite (WAL mode)                  │  │
│  │  groups │ messages │ responses │ contacts │ audit_log    │  │
│  └─────────────────────────┬───────────────────────────────┘  │
│                            │                                  │
├────────────────────────────┼──────────────────────────────────┤
│  Docker Network: validatorinfo_main (external)                │
│                            │                                  │
│  ┌─────────────────────────▼──────────────────────────────┐  │
│  │  ValidatorInfo                                          │  │
│  │  - RAG API: http://validatorinfo-main-frontend:3000    │  │
│  │      /api/rag/search                                    │  │
│  │  - DB: postgresql via DATABASE_URL env                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Почему один процесс

- Telethon (user account) и aiogram (bot account) — оба async, один event loop
- `claude -p` вызывается через `asyncio.create_subprocess_exec` — неблокирующий
- Нет IPC, нет polling, нет рассинхронизации
- Approval callback в aiogram напрямую передаёт ответ в Sender

### Failure isolation

- **claude -p завис**: timeout 60с → SIGTERM → 5с → SIGKILL. Семафор ограничивает 2 concurrent процесса
- **aiogram упал**: Telethon продолжает слушать. Ответы копятся в pending. При восстановлении — повторная отправка inline-кнопок
- **При рестарте**: `sending` → `queued` (повтор), `pending_approval` → проверка TTL → `expired` или повтор
- **SQLite заблокирована**: WAL mode + `busy_timeout=10000`. При персистентной блокировке >30с — CRITICAL log
- **Telegram reconnect**: Telethon auto-reconnect (встроенный). Все `sending` → `queued`

---

## Data Flow

### 1. Реактивный (keyword match)

```
Сообщение в группе
  → Telethon event handler
  → RateLimiter.can_respond(chat_id)?
  → keyword detection (coarse prefilter, не полноценный topic detection)
  → match? → сохранить в SQLite
  → skip rate check (~30% пропускаем для естественности)
  → RAG API запрос (если topic связан с сетью/валидатором)
  → ValidatorInfo DB (если нужны актуальные числа: APR, validators)
  → claude -p subprocess: CLAUDE.md (автоподхват) + промпт + RAG + DB данные
  → claude возвращает JSON: {action, text, confidence, reason}
  → confidence >= 0.6 && action == "respond"?
  → INSERT INTO responses (status='pending_approval')
  → aiogram отправляет Ивану enriched approval message
  → Иван нажимает Approve/Reject/Edit
  → Approve → re-validate limits → глобальный интервал (min 60с) → typing delay → send
```

### 2. Проактивный (каждые 10 минут)

```
Cron (asyncio timer)
  → для каждой active группы: scoring model оценивает треды
  → top-3 кандидата с score >= 0.5
  → каждый → claude -p для оценки
  → результаты → SQLite status='pending_approval' → aiogram approval
```

### 3. Вступление в группы

```
Агент (или ручная команда) предлагает группу
  → aiogram бот Ивану: "Вступить в @cosmosproject? 12K members, EN"
  → Approve → Telethon JoinChannelRequest с delay
  → warmup_until = now() + random(3h, 6h)
```

---

## Response Lifecycle

### State Machine

```
                              ┌─────────────────────────────────┐
                              │                                 │
                              ▼                                 │
 ┌───────────┐  conf≥0.6  ┌──────────────────┐  TTL 30min  ┌─────────┐
 │ candidate  │──────────▶│ pending_approval  │────────────▶│ expired │
 └───────────┘            └──────────────────┘              └─────────┘
       │                     │       │       │
       │ dedup: уже есть     │       │       │ новый ответ на
       │ pending для         │       │       │ тот же тред
       │ (chat_id,reply_to)  │       │       │
       ▼                     │       │       ▼
 ┌─────────────┐             │       │    ┌─────────────┐
 │ superseded  │◀────────────┘       │    │ superseded  │
 │ (старый)    │                     │    └─────────────┘
 └─────────────┘                     │
                    Approve ─────────┼──────── Reject
                       │             │            │
                       ▼             │            ▼
                 ┌──────────┐       │      ┌──────────┐
                 │ approved │       │      │ rejected │
                 └──────────┘       │      └──────────┘
                       │            │
                       │    Edit ───┘
                       │      │
                       │      ▼
                       │  ┌────────┐
                       │  │ edited │
                       │  └────────┘
                       │      │
                       ▼      ▼
                 ┌──────────────┐
                 │    queued    │◀──── retry (FloodWait, network error)
                 └──────────────┘
                       │
                 re-validate:
                 - rate limits OK?
                 - original msg alive?
                       │
                       ▼
                 ┌──────────┐
                 │ sending  │ (typing delay)
                 └──────────┘
                    │     │
                    ▼     ▼
              ┌──────┐ ┌────────┐
              │ sent │ │ failed │
              └──────┘ └────────┘
```

### Ключевые правила

- **Дедупликация**: max 1 pending/queued ответ на пару `(chat_id, in_reply_to)`. При создании нового — старый → `superseded`
- **TTL**: reactive → expired через 30 минут (контекст беседы быстро устаревает). Proactive → expired через 2 часа (тема медленнее уходит). Expired = ignored, no backfill
- **Re-validation при отправке**: лимиты проверяются повторно (могли измениться пока ждали approval). Если оригинальное сообщение удалено → `rejected` (причина: original_deleted)
- **Retry**: FloodWait → `queued` с задержкой. Network error → до 3 retry с exponential backoff. ChatWriteForbidden → терминальный `failed`, группа → `banned`
- **Терминальные**: `sent`, `rejected`, `expired`, `superseded`, `failed` (с retry_count >= 3) — хранятся для аудита

### Дедупликация (SQLite trigger)

```sql
CREATE TRIGGER enforce_single_pending
BEFORE INSERT ON responses
WHEN NEW.status IN ('candidate', 'pending_approval', 'queued', 'sending')
BEGIN
    UPDATE responses
    SET status = 'superseded', expired_at = strftime('%Y-%m-%dT%H:%M:%S', 'now')
    WHERE chat_id = NEW.chat_id
      AND in_reply_to = NEW.in_reply_to
      AND status IN ('candidate', 'pending_approval', 'queued');
END;
```

---

## ValidatorInfo Integration

### RAG API
```
GET http://validatorinfo-main-frontend:3000/api/rag/search?q={topic}&limit=15
Header: x-rag-api-token: {RAG_API_TOKEN}

Params: q (query), limit (max 30), speaker (GUEST/HOST/ALL), validatorId (int)

Response: {
  results: [{
    quote, context, speakerRole, speakerName,
    validatorId, validatorMoniker, mentionedEntities,
    episodeTitle, episodeUrl, similarity
  }]
}
```

### DB Adapter Layer (для структурированных данных)

```python
# src/validatorinfo.py

class ValidatorInfoAdapter:
    """Изолированный доступ к ValidatorInfo.
    Все SQL — в одном файле. При смене schema — обновлять только здесь.
    """
    SCHEMA_VERSION = "2026-03-30"

    async def get_chain_apr(self, chain_name: str) -> float | None
    async def get_validator_count(self, chain_name: str) -> int | None
    async def get_active_proposals(self, chain_name: str) -> list[dict]
    async def get_validator_info(self, moniker: str) -> dict | None
    async def health_check(self) -> bool
```

Принципы:
- **Read-only** connection (read-only PostgreSQL user)
- **Все запросы в одном файле** — при миграции ValidatorInfo обновлять только `validatorinfo.py`
- **Connection pool**: asyncpg, min=1, max=3
- **Query timeout**: 5 секунд
- **TTL cache**: 5 минут для APR и validator counts (данные не меняются каждую секунду)
- **Fallback**: DB unavailable → return None. Claude работает без свежих чисел
- **Health check**: `SELECT 1` каждые 60с. 3 failure → mark unavailable, retry каждые 5 мин
- **Schema validation on startup**: тестовый запрос для каждого метода. Fail → ERROR log, degrade gracefully

### Docker networking

Growth-agent подключается к `validatorinfo_main` как external network. Из этой сети — по **container_name** (не service name):
- Frontend: `validatorinfo-main-frontend:3000`
- DB: через `DATABASE_URL` env

---

## CLAUDE.md для агента

```markdown
# Growth Agent — Alex

You are Alex, a Web3 enthusiast and staking researcher who participates
in Telegram group chats. You have access to real data from ValidatorInfo.

## Personality
- Knowledgeable but not arrogant
- Asks questions, genuinely curious
- Short responses: 1-3 sentences, max 5 for complex topics
- Casual tone, occasional emoji
- Admits when doesn't know something
- Match language of conversation (RU or EN)

## Knowledge
- You have access to ValidatorInfo data (APR, validators, governance)
- You know CitizenWeb3 podcast content via RAG
- Reference specific data when relevant
- Link to validatorinfo.com for details

## Rules
- NEVER spam or self-promote unprompted
- Mention CitizenWeb3/ValidatorInfo only when topic DIRECTLY matches
- Do NOT start with greetings or "great question!"
- Output JSON: {"action": "respond"|"skip", "text": "...", "confidence": 0-1, "reason": "..."}
- confidence < 0.6 = auto-skip
- When uncertain about safety → output skip

## Content Safety (NEVER do)
- Price predictions or investment advice
- Custody/security advice beyond general patterns
- Accusations of fraud without verified on-chain data
- Negative discussion of competing projects
- FOMO/FUD language
- Regulatory or tax advice
- Airdrop eligibility discussion

## What you promote (only when topic directly matches)
- validatorinfo.com — for chain data, APR, validators
- CitizenWeb3 podcast — when topic matches an episode
- @citizenweb3 channel — for staking community
```

---

## Content Safety Policy

### Абсолютные запреты (NEVER-DO)

**Финансовые**:
- Прогнозы цен, инвестиционные рекомендации, FOMO/FUD язык

**Безопасность**:
- Советы по seed phrase, private key, конкретным custody-решениям
- Допустимо: общие паттерны уровня «используйте hardware wallet» без конкретных продуктов

**Репутация**:
- Обвинения валидаторов/проектов в fraud/scam без on-chain данных
- Негативное обсуждение конкурирующих проектов
- Распространение непроверенных слухов

**Поведение**:
- Инициирование DM с пользователями
- Более одной ссылки в сообщении
- Споры с администраторами групп
- Публикация приватной информации

### Серые зоны (всегда skip)

- Регуляция и юридический статус токенов
- Налогообложение криптовалют
- Сравнение доходности конкретных валидаторов
- Airdrop eligibility

### Правило неопределённости

Если Claude не уверен что ответ безопасен → **обязан вернуть skip**.

---

## claude -p Runtime Resilience

### Вызов

```python
proc = await asyncio.create_subprocess_exec(
    "claude", "-p", prompt,
    "--model", "claude-sonnet-4-6",
    "--output-format", "text",
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    cwd="/app",  # CLAUDE.md подхватывается автоматически
)
```

### Timeout и kill

| Параметр | Значение |
|----------|----------|
| Основной timeout | 60 секунд |
| SIGTERM grace | 5 секунд |
| SIGKILL | Безусловный после grace |

### JSON parse

1. `json.loads(raw_text)` — весь ответ
2. Fallback: найти первый `{` и последний `}`, парсить подстроку
3. Fail → skip, log error

### Retry policy

| Условие | Действие |
|---------|----------|
| Timeout | 1 retry через 5с |
| Parse error | 1 retry через 5с |
| Auth error | **Не повторять**. CRITICAL log, alert Ivan, полная остановка генерации |
| Rate limit | Exponential backoff: 30с → 60с → 120с → 300с |

### Concurrency

```python
claude_semaphore = asyncio.Semaphore(2)  # max 2 параллельных вызова
```

### Degraded mode

**Триггер**: 3 consecutive failures.

1. CRITICAL log + alert Ivan
2. Остановка генерации на 15 минут
3. Продолжаем слушать и сохранять сообщения (для contacts и topic_relevance)
4. Health check каждые 5 мин: `claude -p "ping"` с timeout 10с
5. При успехе — выход из degraded mode

### Recovery policy (единая для всех degraded/listen-only ситуаций)

**Backlog игнорируется.** При выходе из degraded mode или при старте в degraded → recovery обрабатывает **только новые сообщения** с момента восстановления. Сообщения, пришедшие во время downtime, не backfill'ятся:
- Reactive: keyword match работает только на live incoming events
- Proactive: следующий 10-мин цикл берёт последние 2 часа из буфера, но не пытается «наверстать» пропущенные ответы
- Нет очереди «отложенных для обработки» сообщений

Обоснование: ответ через 15+ минут после сообщения в чате выглядит неестественно и снижает value.

### OAuth expiration

stderr содержит «auth» / «unauthorized» / «token expired»:
- Полная остановка генерации (не 15 мин, а до ручного вмешательства)
- CRITICAL alert Ivan: «Claude OAuth expired. Требуется re-auth.»
- Агент продолжает слушать, но не вызывает claude -p

---

## aiogram Approval Bot

### Enriched Approval Message

```
📩 Web3 Society (EN) | @username wrote:
"What's the best validator for Cosmos staking?"

🤖 Alex wants to reply (value, confidence: 0.82):
"APR on Cosmos Hub is around 18% right now. I'd look at
validators with high uptime and reasonable commission —
validatorinfo.com/cosmos has a good comparison."

📊 Sources: RAG (2 quotes, similarity 0.78), DB (APR: 18.2%)
⚠️ Contains link (1) | Contains promo: yes (ValidatorInfo)
📈 Group stats: 2/3 daily limit | Last response: 2h ago

[✅ Approve] [❌ Reject] [✏️ Edit] [⏭️ Skip group today]
```

### Поля для user

- **Response type**: value | promo | proactive
- **Confidence score**
- **Source summary**: RAG quotes + DB data
- **Link count + promo flag** (+ warning если `link_tolerance = limited/forbidden`)
- **Group rate limit status**
- **Time since last response в группе**

### Команды

| Команда | Действие |
|---------|----------|
| ✅ Approve | Ответ → queued → send |
| ❌ Reject | Ответ отклонён (опциональная причина) |
| ✏️ Edit | Ivan пишет свой вариант → preview → confirm → queued |
| ⏭️ Skip group today | Блокировать группу до конца дня |
| `/status` | Статистика: группы, ответы, rejection rate |
| `/pause` | Глобальная пауза |
| `/resume` | Возобновить |
| `/join @group` | Вступить в группу |
| `/leave @group` | Покинуть группу |
| `/groups` | Список групп со статусами |
| `/note <chat_id> <текст>` | Заметка к группе |
| `/forget <user_id>` | Удалить контакт |

### Таймаут

TTL зависит от типа: reactive → 30 мин, proactive → 2 часа. По истечении → `expired`, сообщение обновляется: «⏰ Expired». Expired ответы не backfill'ятся — контекст уже ушёл.

---

## Anti-ban

### Лимиты (config.yaml)

```yaml
limits:
  join_groups_per_day: 5
  messages_per_day_total: 20
  messages_per_group_per_day: 3
  promo_per_group_per_week: 1
  min_delay_between_sends: 60
  typing_duration: [3, 15]
  cooldown_after_join_hours: 0    # warmup вместо cooldown
  warmup_hours_min: 3
  warmup_hours_max: 6
  skip_rate: 0.3
  global_hard_cap_daily: 30
  promo_hard_cap_daily: 5
```

### Warmup State Machine

```
joined → warmup (3-6ч random: только слушаем)
  → active (отвечаем с approval)
  → cooldown (после инцидента, 1-24ч)
  → paused (ручная пауза /pause)
  → left / banned (терминальные)
```

### RateLimiter — обязательные проверки перед ответом

1. Группа в статусе `active`
2. `warmup_until` прошёл
3. `messages_per_day_total` не превышен (COUNT responses WHERE sent_at today)
4. `messages_per_group_per_day` не превышен для chat_id
5. `promo_per_group_per_week` не превышен (если промо)
6. `min_delay_between_sends` с последней отправки (глобально)
7. Skip rate: `random() > 0.3` (30% пропуск)
8. **Global hard caps**: 30 msg/day, 5 promo/day

### Дополнительные меры

- **Jitter**: ±30с к delay между отправками
- **FloodWaitError**: при получении — cooldown на указанное время + уведомление Ivan при >300с
- **Feedback signals**: удалённое сообщение → `admin_strictness` повышается. Warning от админа → `cooldown` 24ч. Повторные reject/edit → пересмотр промптов

---

## Group Profile Model

```sql
CREATE TABLE groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER UNIQUE NOT NULL,
    name TEXT,
    username TEXT,
    language TEXT DEFAULT 'mixed',       -- ru | en | mixed
    member_count INTEGER,
    joined_at TIMESTAMP,
    warmup_until TIMESTAMP,              -- joined_at + random(3h, 6h)
    status TEXT DEFAULT 'warmup',
    -- Activity tracking
    last_response_at TIMESTAMP,
    responses_today INTEGER DEFAULT 0,
    responses_today_reset_at TIMESTAMP,
    promo_this_week INTEGER DEFAULT 0,
    promo_week_reset_at TIMESTAMP,
    -- Group character (adaptive)
    topic_relevance REAL DEFAULT 0.5,    -- staking topics / total messages (48h)
    admin_strictness TEXT DEFAULT 'unknown', -- unknown | relaxed | moderate | strict
    link_tolerance TEXT DEFAULT 'unknown',  -- unknown | allowed | limited | forbidden
    last_incident_at TIMESTAMP,
    notes TEXT                           -- manual notes from Ivan
);
```

### Adaptive fields

**admin_strictness** обновляется по инцидентам:
- Наше сообщение удалено → unknown→moderate, moderate→strict
- Warning от админа → сразу strict, группа → cooldown 24ч
- Бан/кик → banned, admin_strictness = strict
- 30 дней без инцидентов → strict→moderate, moderate→relaxed

**link_tolerance**:
- Наше сообщение со ссылкой удалено → unknown→limited, limited→forbidden
- Другие постят ссылки без последствий → unknown→allowed
- forbidden = агент никогда не включает ссылки (prompt constraint)

**topic_relevance**: `count(keyword_messages) / count(all_messages)` за 48ч. Обновляется каждый час. `< 0.05` за 30 дней → кандидат на выход.

---

## Proactive Scoring Model

Каждые 10 минут, для active групп — оценка тредов за последние 2 часа.

### Факторы

| # | Фактор | Вес | Описание |
|---|--------|-----|----------|
| 1 | Recency | 0.2 | <30 мин = 1.0, linear decay до 120 мин |
| 2 | Unanswered question | 0.3 | Тред заканчивается на `?`, нет ответа 5+ мин |
| 3 | Topic relevance | 0.2 | Keyword match: high/medium/low тематики |
| 4 | Thread heat | 0.1 | 3+ сообщений за 15 мин |
| 5 | Novelty | 0.1 | Давно не отвечали в группе |
| 6 | Last activity | 0.05 | Глобально давно молчим |
| 7 | Promo opportunity | 0.0 (Phase 1), post-filter (Phase 2+) | Не фактор ранжирования, а пост-фильтр: если value score >= 0.5 И тема совпадает с CW3 → пометить contains_promo |
| 8 | Duplicate risk | -0.5 | Похожий вопрос уже был отвечен |

**Формула**: `score = recency*0.2 + unanswered*0.3 + topic*0.2 + heat*0.1 + novelty*0.1 + last_activity*0.05 - duplicate*0.5`

Promo opportunity **не участвует в scoring** — это post-filter. Если кандидат прошёл value threshold (score >= 0.5) и тема напрямую совпадает с CW3/ValidatorInfo → помечается `contains_promo=TRUE`. В Phase 1 promo-пометка отключена полностью.

**Порог**: score >= 0.5 → отправляется в claude -p. **Max 3 кандидата** за цикл.

Keyword match в reactive mode — **coarse prefilter**, не полноценный topic detection. Claude принимает финальное решение.

---

## Database Schema

```sql
-- Группы (см. Group Profile Model выше)

-- Сообщения (retention 48 часов)
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    sender_id INTEGER,
    sender_name TEXT,
    text TEXT,
    topic TEXT,
    reply_to_message_id INTEGER,
    timestamp TIMESTAMP,
    UNIQUE(chat_id, message_id)
);

-- Ответы агента (бессрочно, audit trail)
CREATE TABLE responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    in_reply_to INTEGER,
    -- Content
    draft_text TEXT,
    edited_text TEXT,
    final_text TEXT,
    -- Classification
    response_type TEXT,           -- value | promo | proactive
    confidence REAL,
    reason TEXT,
    -- Sources
    rag_results TEXT,             -- JSON
    db_data TEXT,                 -- JSON
    model_name TEXT,
    prompt_hash TEXT,
    -- Lifecycle
    status TEXT DEFAULT 'candidate',
    created_at TIMESTAMP,
    approved_at TIMESTAMP,
    approved_by TEXT,             -- 'ivan' | 'auto'
    edited_at TIMESTAMP,
    sent_at TIMESTAMP,
    expired_at TIMESTAMP,
    failed_at TIMESTAMP,
    send_error TEXT,
    superseded_by INTEGER,
    retry_count INTEGER DEFAULT 0,
    -- Flags
    contains_link BOOLEAN DEFAULT FALSE,
    contains_promo BOOLEAN DEFAULT FALSE
);

-- Контакты (бессрочно, core asset)
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT,
    first_seen_at TIMESTAMP,
    last_seen_at TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    staking_message_count INTEGER DEFAULT 0,
    topics TEXT,                          -- JSON: {"cosmos": 12, "polkadot": 3}
    groups_active_in TEXT,               -- JSON: [chat_id_1, chat_id_2]
    groups_in_common INTEGER DEFAULT 0,
    relevance_score REAL DEFAULT 0.0,
    relevance_updated_at TIMESTAMP,
    times_replied_to INTEGER DEFAULT 0,
    last_replied_to_at TIMESTAMP,
    notes TEXT
);

-- Audit log (бессрочно, полный контекст каждого ответа)
CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,              -- response UUID
    created_at TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER,
    original_text TEXT,
    topic TEXT,
    rag_query TEXT,
    rag_results TEXT,                 -- JSON
    claude_prompt TEXT,
    claude_raw TEXT,
    claude_parsed TEXT,               -- JSON
    claude_duration_ms INTEGER,
    approval_decision TEXT,
    approval_edit TEXT,
    final_text TEXT,
    sent_at TEXT,
    error TEXT
);

-- Индексы
CREATE INDEX idx_messages_chat_ts ON messages(chat_id, timestamp);
CREATE INDEX idx_messages_topic ON messages(topic);
CREATE INDEX idx_responses_status ON responses(status);
CREATE INDEX idx_responses_chat_status ON responses(chat_id, status);
CREATE INDEX idx_responses_created ON responses(created_at);
CREATE INDEX idx_contacts_relevance ON contacts(relevance_score DESC);
CREATE INDEX idx_contacts_last_seen ON contacts(last_seen_at);
CREATE INDEX idx_audit_chat ON audit_log(chat_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
```

### SQLite настройки
```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=10000;
```

---

## Retention Model

| Уровень | Данные | Retention | Обоснование |
|---------|--------|-----------|-------------|
| Hot | messages | 48 часов | Только для контекста reactive/proactive |
| Warm (metadata) | responses (без payload), audit_log (redacted) | Бессрочно | Lifecycle tracking, analytics |
| Warm (payload) | audit_log.original_text, claude_prompt, claude_raw | 90 дней → redaction | Полный контент нужен для debugging, потом — redact |
| Long-lived | contacts, groups | Бессрочно | Core asset, воронка CW3 |

### Cleanup schedule

- Каждый час: `DELETE FROM messages WHERE timestamp < datetime('now', '-48 hours')`
- Ежедневно: redaction audit_log payload старше 90 дней:

```sql
UPDATE audit_log SET
    original_text = '[redacted]',
    claude_prompt = '[redacted]',
    claude_raw = '[redacted]',
    rag_results = '[redacted]'
WHERE created_at < datetime('now', '-90 days')
  AND original_text != '[redacted]';
```

Остаются: chat_id, topic, approval_decision, final_text (то что было отправлено публично), sent_at, error. Этого достаточно для долгосрочной аналитики без хранения чужого контента.

### Privacy (contacts)

- Хранятся только публичные данные (username, display_name, user_id — видны всем в группе)
- Содержимое сообщений НЕ привязано к контакту (только счётчики и scores)
- audit_log хранит original_text 90 дней для debugging, потом redact
- Нет DM данных, нет email/телефонов
- Доступ только через SQLite в Docker volume, нет внешнего API
- `/forget <user_id>` — полное удаление контакта + redaction из audit_log

---

## Observability

### Structured logging (JSON Lines → stdout)

```json
{"ts": "2026-03-30T14:22:01Z", "level": "INFO", "component": "responder",
 "event": "claude_response", "chat_id": -1001234, "response_id": "abc123",
 "duration_ms": 4521}
```

### Ключевые events

| Event | Level | Что |
|-------|-------|-----|
| message_received | DEBUG | Входящее из группы |
| topic_detected | INFO | Keyword match |
| claude_invoked / claude_response | INFO | Вызов/ответ Claude |
| claude_timeout / claude_parse_error | ERROR | Проблемы Claude |
| claude_auth_error | CRITICAL | OAuth expired |
| degraded_mode_entered/exited | CRITICAL/WARNING | Degraded mode |
| approval_sent / approval_received | INFO | Approval flow |
| message_sent / message_send_error | INFO/ERROR | Отправка |
| rate_limited | WARNING | Сработал лимит |

### Метрики (/status + будущий dashboard)

- `pending_queue_size`, `groups_by_status`
- `claude_latency_p50/p95`, `rag_latency_p50/p95`, `approval_latency_avg`
- `messages_sent_today` (total + per group)
- `send_success_rate`, `rejection_rate`, `edit_rate`
- `flood_wait_count`

### Алерты (через aiogram Ivan)

| Условие | Уровень |
|---------|---------|
| Degraded mode entered | 🔴 CRITICAL |
| FloodWait > 300s | 🟡 WARNING |
| Group → banned | 🟠 ERROR |
| Daily limit reached | 🟡 WARNING |
| Rejection rate > 50% (24h) | 🟡 WARNING |
| Claude OAuth error | 🔴 CRITICAL |
| RAG API down > 5 min | 🟡 WARNING |

---

## Security

### Управление секретами

| Секрет | Передача | Хранение |
|--------|----------|----------|
| Telegram session | Volume mount ./data:/app/data | Файл на хосте, никогда в git |
| Claude OAuth | Env vars (CLAUDE_CODE_OAUTH_TOKEN и др.) | ~/.claude/ в контейнере |
| DATABASE_URL, RAG_API_TOKEN | Env vars | .env на хосте (не в git) |
| TELEGRAM_BOT_TOKEN | Env var | .env на хосте |

### .gitignore

```gitignore
.env
.env.*
data/
*.session
*.session-journal
*.db
*.db-journal
*.db-wal
.claude/
__pycache__/
*.pyc
.venv/
node_modules/
.DS_Store
```

### Контейнерная безопасность

- Нет SSH, нет exposed портов
- Non-root user внутри контейнера (`agent`)
- Логи только через docker logs

### Writable mounts и paths

| Path | Назначение | Mount |
|------|-----------|-------|
| `/app/data/` | SQLite, Telethon session | Volume: `./data:/app/data` |
| `/home/agent/.claude/` | Claude CLI state, OAuth tokens | Named volume или entrypoint-created |
| `/home/agent/.claude.json` | Claude auth config | Создаётся entrypoint из env vars |
| `/tmp/` | claude -p subprocess temp files | tmpfs (in-memory) |

**Entrypoint contract**: перед запуском `main.py` entrypoint-скрипт создаёт `~/.claude.json` из env vars (CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_ACCOUNT_UUID, CLAUDE_EMAIL, CLAUDE_ORG_UUID). Если env vars отсутствуют — agent стартует без Claude auth (degraded mode).

Все остальные пути — read-only.

### Incident Response

| Инцидент | Действие |
|----------|----------|
| **Session compromised** | Stop container → revoke sessions на my.telegram.org → удалить session file → re-auth → restart |
| **Claude OAuth expired** | `docker exec -it tg-agent claude login` → agent auto-recovers на health check |
| **RAG_API_TOKEN leaked** | Ротировать в ValidatorInfo → обновить .env → restart |
| **Аккаунт забанен в группе** | Auto: group → banned. Ivan оценивает причину через audit_log |
| **Аккаунт забанен глобально** | All stops. Новый аккаунт + session + rejoin (manual) |

### Backup

- SQLite: daily `VACUUM INTO '/backup/agent_YYYYMMDD.db'`
- Session: копия при изменении
- .env: secure backup при изменении

---

## Failure Matrix

### Telegram

| Сбой | Автоматическая реакция | Ручное |
|------|----------------------|--------|
| FloodWait | queued с задержкой, alert при >300s | Нет |
| Reconnect | Telethon auto-reconnect. sending → queued | Нет |
| Session expired | Полная остановка, CRITICAL alert | Re-auth |
| Account banned | Всё останавливается, CRITICAL alert | Новый аккаунт |
| Chat unavailable | Группа → banned, ответы → failed | Ревью |

### claude -p

| Сбой | Автоматическая реакция | Ручное |
|------|----------------------|--------|
| Timeout 60s | 1 retry через 5с | Нет |
| JSON parse error | 1 retry, потом skip | Проверить промпт |
| Hung process | SIGTERM → SIGKILL | Нет |
| Auth/OAuth error | Полная остановка, CRITICAL | Re-auth |
| Rate limit | Exponential backoff 30-300с | Нет |
| 3 consecutive failures | Degraded mode 15 мин | Нет |

### ValidatorInfo

| Сбой | Автоматическая реакция | Ручное |
|------|----------------------|--------|
| RAG timeout/500 | 2 retry, fallback без RAG | Нет |
| RAG token expired | Fallback без RAG, alert | Ротация токена |
| RAG down | Circuit breaker, alert >5 мин | Проверить контейнер |
| DB connection refused | Fallback без DB данных | Проверить PostgreSQL |
| DB schema changed | Error log, fallback | Обновить adapter |

### SQLite

| Сбой | Автоматическая реакция | Ручное |
|------|----------------------|--------|
| Database locked | WAL + busy_timeout 10s | Проверить процессы |
| Corrupt | Переключение на backup | Восстановление |
| Disk full | Cleanup терминальных >7 дней, alert | Расширить диск |

### Docker restart

- `sending` → `queued` (повтор)
- `pending_approval` → проверка TTL → expired или повтор inline-кнопок
- Startup reconciliation: проверка всех active чатов через `get_dialogs()`

---

## Operational Contract

### Network: validatorinfo_main

- **Owner**: ValidatorInfo project
- **Must exist** before growth-agent starts
- growth-agent подключается как external

### Service dependencies

| Service | Container name | Port | Protocol |
|---------|---------------|------|----------|
| Frontend (RAG API) | validatorinfo-main-frontend | 3000 | HTTP |
| PostgreSQL | (from DATABASE_URL) | 5432 | PostgreSQL |

### Startup

1. Retry RAG + DB health check каждые 10с, до 5 минут
2. Оба fail → start в degraded mode (listen-only, сохранение сообщений для contacts)
3. Recovery автоматически при следующем health check
4. **Backlog не обрабатывается** — при выходе из degraded mode работаем только с новыми сообщениями

### Redeploy resilience

ValidatorInfo redeploy → потеря связи на 30-60с.
- RAG client: retry 3× с 5с backoff
- DB: asyncpg pool auto-reconnect
- Оба down → слушаем + отправляем approved из очереди, но не генерируем новые ответы с данными

---

## Rollout Governance

### Фаза 1: Canary (5 групп, 1-2 недели)

**Все ответы через ручное одобрение.**

Gate для перехода к Фазе 2:
- 0 банов
- Rejection rate < 40%
- >= 20 одобренных ответов
- <= 2 удалённых сообщения
- 0 предупреждений от админов

**Kill switch**: бан в любой группе → /pause_all, полный разбор.

### Фаза 2: Расширение (+10 групп, 2-4 недели)

Gate от canary + Ivan подтверждает `/approve_expansion`.

Опционально: auto-approve для confidence > 0.85 + response_type = value (не промо). Промо всегда ручное.

Kill: 2+ бана в неделю → /pause_all.

### Фаза 3: Steady state (все группы)

Gate: 30+ дней без инцидентов.

- Опциональный auto-approve для confidence > 0.9
- Ежемесячный ревью профилей групп
- Автопредложение покинуть группы с topic_relevance < 0.05

### Rollback conditions (все фазы)

| Событие | Реакция |
|---------|---------|
| Бан | Группа навсегда banned |
| FloodWait > 300s | Пауза 1ч |
| Rejection > 50% три дня | Полная пауза, пересмотр промптов |
| /pause от Ivan | Немедленная глобальная пауза |

### Hard caps (зашиты в код)

- Max 50 групп
- Max 30 сообщений/день (global)
- Max 5 промо/день (global)

---

## Cost Model

| Ресурс | Прямая стоимость | Ограничение | Риск |
|--------|-----------------|-------------|------|
| claude -p (Max) | $0 | Quota (undocumented для CLI) | Quota может измениться |
| Telegram user account | $0 | 1 аккаунт, риск бана | Потеря = rejoin всех групп |
| aiogram bot | $0 | Стандартные Bot API limits | Низкий |
| Docker | $0 (сервер ValidatorInfo) | Shared resources | Конкуренция за CPU/RAM |
| ValidatorInfo RAG/DB | $0 | ~20 RAG calls/day, ~50 DB queries | Нагрузка на production |

**Скрытые затраты**:
- Ivan: ~15-30 мин/день на approval (5-10 ответов × 2-3 мин)
- Prompt engineering: ongoing
- Incident response: по ситуации

**Реальный бюджет**: bounded by moderation bandwidth, CLI quota, и Telegram risk budget.

---

## Метрики успеха

### Output metrics (месяц 1)

| Метрика | Target |
|---------|--------|
| Групп подключено | 15-25 |
| Ответов в день | 5-10 |
| Rejection rate | < 30% |
| Новых участников в CW3 | 20-50 |
| Бан/kick | 0 |

### Quality & guardrail metrics

| Метрика | Target |
|---------|--------|
| Approval latency (median) | < 15 min |
| Edit rate | < 20% |
| Source-backed response ratio | > 60% |
| Admin friction signals | 0 |
| Per-group sentiment | Neutral or positive |
| Ignored-response rate (expired) | < 25% |
| Claude degraded mode incidents/week | < 2 |

---

## Assumption Register

| # | Assumption | If violated | Detection | Mitigation |
|---|-----------|-------------|-----------|------------|
| 1 | Claude Max subscription active | claude -p auth fails | Health check | Pause, notify Ivan |
| 2 | claude -p CLI interface stable | Output format changes | Parse failures spike | Pin CLI version, test on upgrade |
| 3 | Telegram account not banned | All ops stop | Connection error | New account (manual) |
| 4 | validatorinfo_main network exists | Can't reach RAG/DB | Startup health check | Degraded mode |
| 5 | RAG API token valid | 404 from RAG | HTTP 404 | Rotate token |
| 6 | ValidatorInfo DB schema stable | Query errors | Schema validation on startup | Update adapter |
| 7 | Ivan available within 30 min | Responses expire | Pending queue grows | Auto-approve high-confidence (future) |
| 8 | Telegram rate limits don't tighten | More FloodWait | Frequency increase | Tighten our limits |
| 9 | Groups don't go private | Join fails | Join errors | Skip, try next |
| 10 | Docker volume persistent | Session/DB lost | Missing files on start | Volume mount required |

---

## Структура проекта

```
telegram-growth-agent/
├── docker-compose.yml
├── Dockerfile
├── .env                    # gitignored
├── .gitignore
├── config.yaml
├── CLAUDE.md               # персона для claude -p
├── requirements.txt        # telethon, aiogram, aiosqlite, asyncpg, aiohttp, structlog
├── main.py                 # entry point: Telethon + aiogram + cron loops
├── src/
│   ├── config.py           # config + env loader
│   ├── db.py               # SQLite (WAL mode)
│   ├── listener.py         # message collection + keyword trigger
│   ├── responder.py        # claude -p subprocess wrapper
│   ├── sender.py           # typing simulation + send via Telethon
│   ├── approval.py         # aiogram bot: inline buttons, commands, enriched UI
│   ├── rate_limiter.py     # anti-ban: все проверки
│   ├── rag.py              # ValidatorInfo RAG API client
│   ├── validatorinfo.py    # ValidatorInfo DB adapter layer
│   ├── proactive.py        # 10-min cron: scoring model + claude evaluation
│   ├── joiner.py           # group join с approval
│   ├── contacts.py         # contact scoring + updates
│   └── cleanup.py          # 48h retention
├── data/                   # volume mount, gitignored
│   ├── session.session
│   └── agent.db
└── tests/
```

---

## Docker

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @anthropic-ai/claude-code && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash agent
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chown -R agent:agent /app

USER agent
CMD ["python", "main.py"]
```

```yaml
# docker-compose.yml
services:
  tg-growth-agent:
    build: .
    container_name: tg-growth-agent
    restart: always
    volumes:
      - ./data:/app/data
      - ./config.yaml:/app/config.yaml:ro
    env_file: .env
    environment:
      - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}
      - CLAUDE_ACCOUNT_UUID=${CLAUDE_ACCOUNT_UUID}
      - CLAUDE_EMAIL=${CLAUDE_EMAIL}
      - CLAUDE_ORG_UUID=${CLAUDE_ORG_UUID}
      - RAG_API_TOKEN=${RAG_API_TOKEN}
      - DATABASE_URL=${DATABASE_URL}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - APPROVAL_CHAT_ID=${APPROVAL_CHAT_ID}
    networks:
      - default
      - validatorinfo_main

networks:
  default:
  validatorinfo_main:
    external: true
```

### Claude Auth в Docker

Entrypoint создаёт `~/.claude.json` с OAuth config (аналогично agents-infrastructure ValidatorInfo):

```json
{
  "hasCompletedOnboarding": true,
  "oauthAccount": {
    "accountUuid": "${CLAUDE_ACCOUNT_UUID}",
    "emailAddress": "${CLAUDE_EMAIL}",
    "organizationUuid": "${CLAUDE_ORG_UUID}"
  }
}
```

---

## Целевые группы

25 групп в 4 wave'ах (каждый через approval):

**Wave 1 — Canary (Cosmos core):**
cosmosproject, CosmosEcosystemChat, cosmonauthq, hubgov, posthumanchat

**Wave 2 — Cosmos сети:**
CosmosEcosystem_ru, osmosis_chat, CelestiaCommunity, neutron_community, joininjective

**Wave 3 — Cosmos + validators:**
dymensionXYZ, AkashNW, quicksilverzone, cosmostation, sg1online

**Wave 4 — ETH staking + Polkadot:**
posthumanrus, lidofinance, Eigenlayerofficialchat, PolkadotOfficial, p2porg
