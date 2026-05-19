# BizDev Outreach MVP: Infra / Runtime / Delivery Proposal

**Source**: [bizdev-outreach-pipeline-v2.md](/Users/user/project/dev/bizdev-email-agent/bizdev-outreach-pipeline-v2.md)  
**Purpose**: implementation-ready proposal для MVP по infra/runtime/delivery  
**Scope**: `partner@citizenweb3.com`, Resend outbound/inbound, Telegram approval loop, local operator dashboard

## 1. Граница MVP

MVP должен опираться на один sending identity, один runtime, один persistence layer и одного approver.

- отправитель: `partner@citizenweb3.com`
- human-in-the-loop: Ivan только через Telegram
- форма рантайма: один deployable service, одна SQLite DB, один публичный webhook receiver
- целевой результат: безопасная отправка, capture replies, approval workflow, базовая observability
- вне MVP: несколько mailbox, автономные reply без approve, distributed queues, multi-user dashboard, advanced analytics

## 2. Базовые assumptions

- Resend является единственным outbound-провайдером в MVP.
- `citizenweb3.com` верифицирован в Resend, SPF/DKIM/MX синхронизированы через Cloudflare.
- Cloudflare Email Routing остаётся включённым для `partner@citizenweb3.com` и дублирует входящие письма в личную почту Ivan.
- Resend Inbound настроен на тот же mailbox и шлёт события в один HTTPS webhook endpoint этого сервиса.
- Для tracking в MVP используется polling; для inbound используется webhook.
- SQLite подходит для MVP, потому что объём approve невысокий, write concurrency ограничен, а runtime остаётся single-instance.
- Dashboard является operational tool, а не основной рабочей поверхностью: local-first, для inspection и manual recovery.

## 3. Resend architecture для `partner@citizenweb3.com`

### Outbound

- Все cold outreach и thread replies отправляются через Resend API от `partner@citizenweb3.com`.
- Каждое исходящее письмо создаёт:
  - одну запись в `emails` для draft/send lifecycle
  - одну запись в `email_threads` для фактического outbound message
  - provider identifiers: `resend_email_id`, provider message id при наличии, thread linkage fields
- Для follow-up и reply должны сохраняться thread headers:
  - `In-Reply-To`
  - `References`
  - нормализация subject с корректным `Re:`
- Отправочная политика MVP:
  - по умолчанию plain text
  - стартовый лимит `50` отправок в день
  - не более одного cold outbound на контакт в активном окне, если не было manual retry

### Inbound

- Resend Inbound принимает replies для `partner@citizenweb3.com` и отправляет их в публичный webhook receiver.
- Cloudflare Email Routing пересылает тот же reply в личную почту Ivan как human copy и provider fallback.
- Webhook receiver обязан:
  - проверить подлинность запроса
  - сохранить raw payload и нормализованные body/headers
  - сматчить входящее письмо с существующим contact/prospect/thread
  - обновить lifecycle status на `replied`
  - отправить Ivan уведомление в Telegram с preview и actions
- Если thread matching не удался, письмо сохраняется как unmatched inbound и выводится в dashboard для manual triage.

### Правило владения thread

Для MVP каждая деловая переписка должна оставаться привязанной к `partner@citizenweb3.com`. Ответы из личной почты Ivan не считаются system-of-record действием.

## 4. Runtime model

### Deployment shape

Одного контейнера достаточно, если внутри живут четыре логических компонента:

- API/webhook server
- Telegram bot
- scheduler
- background worker loop

Все компоненты используют одну SQLite DB на persistent volume и общий application config.

### Processing model

Для MVP нужен DB-backed jobs model, а не внешний queue broker.

- Scheduler создаёт jobs по расписанию.
- Worker loop забирает pending jobs из SQLite через lease/lock semantics.
- Jobs должны быть idempotent и retryable.
- Каждый job пишет понятные state transitions в DB.

Рекомендуемые job types:

- `research_prospect`
- `generate_draft`
- `send_for_approval`
- `send_email`
- `poll_tracking`
- `ingest_inbound_email`
- `generate_reply_draft`
- `send_daily_digest`

### Concurrency rules

- один send worker одновременно
- один inbound ingestion worker одновременно
- ограниченный параллелизм только для research/drafting
- tracking poller работает на отдельном интервале и не блокирует send/reply path

Это снижает SQLite contention и делает failure modes предсказуемыми.

### Failure handling

- Повторы идут через exponential backoff и max-attempt caps.
- Невосстановимые ошибки переводят job в `failed` с reason code.
- Send operations используют idempotency key, чтобы не дублировать outbound после crash/restart.
- Webhook ingestion должен безопасно переживать replay.

## 5. Pre-send guardrails

Каждое исходящее письмо должно пройти все guardrails до того, как Ivan увидит `Send`.

### Hard gates

- у контакта есть email и он syntactically valid
- prospect не был уже контактирован в активном cooldown window
- нет необработанного inbound reply, ожидающего human handling
- confidence выше порога, либо письмо явно помечено как generic
- обязательные research fields для выбранного pillar присутствуют или явно помечены как `unknown`
- не превышены дневной send cap и hourly batch cap

### Content gates

- subject и body не пустые и укладываются в agreed length bounds
- нет неподтверждённых claim, guessed metrics и выдуманной personalization
- stop-slop pass убирает generic AI phrasing, hype и unverifiable statements
- письмо соответствует ровно одному pillar
- CTA остаётся low-pressure и human-readable
- список получателей исключает role aliases с высоким bounce risk, если не было manual approve

### Operational gates

- отправка идёт только внутри configured work window
- блокируются duplicate sends из-за repeated approval или worker retry
- любой cold outbound и любой reply требуют explicit Telegram approval в MVP
- если provider health, DNS alignment или webhook lag выглядят нездоровыми, отправка автоматически ставится на паузу

## 6. Assumptions для local dashboard и webhook receiver

### Local dashboard

Dashboard должен рассматриваться как operator console, а не как основная workflow UI.

- Основные use cases:
  - смотреть prospects, drafts, sends, replies и failed jobs
  - вручную requeue failed jobs
  - видеть unmatched inbound messages
  - смотреть delivery/open/reply timeline
- Deployment assumptions:
  - по умолчанию только локальный доступ (`localhost` или private network)
  - публичная публикация не нужна для MVP
  - если позже нужен удалённый доступ, достаточно simple auth
- Approval actions остаются в Telegram; dashboard actions административные

### Public webhook receiver

Webhook receiver является единственным компонентом, который должен быть доступен из интернета.

- Публичные маршруты MVP:
  - Resend inbound webhook
  - optional health endpoint для ops-checks
- Обязательные защиты:
  - HTTPS termination на nginx или эквиваленте
  - signature/auth verification для входящего webhook
  - request logging с ограничением payload size и безопасным redaction
  - быстрый acknowledge path; более тяжёлая обработка запускается асинхронно после persistence

Рекомендуемое разделение:

- публичный hostname/path только для webhook ingress
- dashboard остаётся приватным, даже если обслуживается тем же приложением

## 7. Delivery slices

### Slice 1: Infra readiness

Цель: mailbox и runtime доступны и доверены.

- домен в Resend верифицирован
- исходящая отправка от `partner@citizenweb3.com` работает
- Cloudflare Email Routing корректно пересылает письма
- публичный HTTPS webhook endpoint доступен
- SQLite volume, env config и container runtime стабильны

Exit criteria: test outbound email успешно отправляется, test inbound email доходит и до webhook, и до forwarding mailbox.

### Slice 2: Outbound approval path

Цель: безопасный manual-to-send loop работает end-to-end.

- prospect/contact можно завести вручную
- draft генерируется и сохраняется
- Telegram single-email review работает
- approve отправляет письмо через Resend
- sent records пишутся с provider ids и timestamps

Exit criteria: Ivan может approve/send cold email из Telegram без shell access.

### Slice 3: Inbound reply capture

Цель: replies сохраняются и возвращаются в workflow.

- inbound webhook persistence
- thread matching
- Telegram reply notification
- reply draft generation stub/manual flow
- reply send из того же mailbox с сохранением threading

Exit criteria: ответ от recipient становится видимым thread event и может быть отправлен обратно через `partner@citizenweb3.com`.

### Slice 4: Background automation

Цель: оператор перестаёт вручную запускать рутинную оркестрацию.

- scheduled batch creation
- research jobs
- draft generation jobs
- tracking poller
- daily digest
- retry и failed-job handling

Exit criteria: система обрабатывает hourly batches в рамках configured work window без ручного запуска.

### Slice 5: Guardrails + ops console

Цель: MVP становится достаточно безопасным для регулярного daily use.

- hard/content/operational guardrails реально enforced
- dashboard показывает jobs, threads, sends и unmatched inbound
- доступны manual requeue и pause controls
- есть alerting на webhook failures, send failures и queue backlog

Exit criteria: сбои диагностируются без прямого просмотра DB, а unsafe sends блокируются автоматически.

## 8. Рекомендуемый порядок реализации

Делать в таком порядке:

1. mailbox + webhook infrastructure
2. outbound approval/send path
3. inbound reply capture
4. scheduler и worker jobs
5. dashboard и operational hardening

Такой порядок даёт самый ранний usable milestone для реальной outreach activity и не тащит лишнюю complexity раньше времени.

## 9. Решения, которые надо зафиксировать до старта

- только single-instance runtime
- SQLite используется и как state store, и как job queue
- Telegram остаётся единственной approval surface
- dashboard является read-heavy admin tooling, а не второй workflow UI
- inbound работает через webhook, tracking через polling
- любой outbound и любой reply требуют explicit approval в MVP
