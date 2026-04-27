# Round 2 Handoff (после компакции)

**Цель документа:** дать после-компакционному self'у точку входа в работу, чтобы не перечитывать 1300-строчный план и не путать «план говорит ✅» с «реально в коде».

---

## Состояние на 2026-04-27

**Ветка:** `prompt-extraction-refactor` (не `tg-growth-agent-llama` как пишет header основного плана — устаревшая инфа в плане, реальность здесь).

**Last commit:** `11f62df Rename follow-up snippet, drop already_offered tracking`.

**Working tree:** 9 файлов unstaged, всё это **Round 1 работа** (iteration-1 первого захода). Не закоммичено.

```
modified:   CLAUDE.md                                    (полная перезапись по B6)
modified:   prompts/qwen_router.md                       (T1+T3 фильтр, без is_reply_to_us)
modified:   prompts/responder_main.md
modified:   prompts/responder_verification.md            (порог 0.9, ORIGINAL DM CONTEXT, $language)
modified:   prompts/snippets/closing_instructions.md
modified:   prompts/snippets/follow_up.md                (M6 ещё не применён — старая жёсткая фраза)
modified:   prompts/snippets/new_message.md
modified:   src/ai/responder.py                          (make_verification_prompt принимает original_dm_*)
modified:   src/core/response_pipeline.py                (thresholds 0.7/0.9, передача original_dm_* в верификатор)
```

**H1 revert статус:** на этой ветке `listener.py:128` уже корректен — `if self.llm_router and not is_reply_to_us:`. Ветка ответвилась до регрессии. `qwen_router.md` и `llm_router.py` в diff — там убраны `is_reply_to_us` параметры. `proactive.py` не модифицирован — никогда не передавал. **Дополнительной работы по H1 не нужно**, факт зафиксирован.

**План документ:** `docs/plans/2026-04-25-aida-trust-first-prompt-rewrite.md` — untracked (тоже не закоммичен). Содержит всё Round 1 + Round 2 решения, audit_id lifecycle, redaction, DoD.

---

## Что читать из плана и в каком порядке

Не читай весь файл подряд. Минимально достаточный набор:

1. **Контекст и scope** — строки 1-22. Чтобы понять, что iteration-1 расширилась дважды: R1 → prompt extraction, Round 2 → schema + parser + validators + audit lifecycle.

2. **Round 2 findings** (`## Round 2 review (2026-04-26): findings`) — что нашли.

3. **Round 2 решения** (`## Round 2 решения (2026-04-26)`) — locked, **не переоткрывать**. Это ответ на каждый finding.

4. **Tool call logging design** (`## Tool call logging design (locked 2026-04-26)`) — сюда же подсекции `audit_id lifecycle` и `Redaction для tool_calls`. Это то, что закрывает High 3 и Medium 2 из ревью плана.

5. **Implementation план** (`## Implementation план (после round 2)`) — 9 шагов в порядке зависимостей.

6. **Definition of Done для iteration-1** — round 1 (✅) и round 2 (пп. 6-14, [ ] pending).

Всё остальное (B1-B9, Locked decisions 1-10, R1-R15, Приложение от начальника) — историческая запись, читать только при сомнении в Locked.

---

## TaskList — ID карта и порядок

`TaskList` в системе. Зависимости настроены через `addBlockedBy`. Порядок имплементации:

| ID | Шаг | Blocked by |
|----|-----|------------|
| #7 | Schema migration (tool_calls + audit_log.status) | — (старт) |
| #15 | db.py: init_audit_log, update_audit_log, save_tool_call, redaction extension | #7 |
| #8 | responder.py: stream-json + tool-call writer + drop language/original_dm_* | #15 |
| #9 | response_pipeline.py: audit lifecycle + validators + H2 gate + DM passthrough | #7, #8 |
| #10 | approval.py:470 — drop fallback chain | — (можно параллельно) |
| #11 | Update prompts (verification, follow_up, main, generation) | — (можно параллельно) |
| #12 | CLAUDE.md (H3 ссылка на section 6, M5 LANGUAGE removal) | — (можно параллельно) |
| #13 | Smoke test on historical chat logs | #9, #10, #11, #12 |
| #14 | Commit | #13 |

Старт после компакции: `#7`.

---

## Locked Round 2 решения (compact, не переоткрывать)

| Finding | Решение |
|---|---|
| **H1** (Qwen bypass) | Уже в коде — direct replies минуют Qwen на listener.py:128. `is_reply_to_us` удалён из qwen_router.md/llm_router.py |
| **H2** (conf без tool grounding) | BOTH: prompt rule «no tool → conf ≤ 0.85» + детерминистический code-gate (`phase1_tools_count == 0 and conf >= 0.9 → clamp to 0.85`). Identity facts из section 6 — explicit carve-out (НЕ считаются factual claim) |
| **H3** (ephemeral vs identity drift) | Section 6 — single source of truth. Gate 2 ссылается на section 6 одной фразой |
| **M1** (DM silent drop) | Верификатор не трогает `dm_request`/`dm_text`. Pipeline берёт их из result1 после слияния |
| **M2** (URL whitelist) | По доменам HTTPS only: `validatorinfo.com`, `podcast.citizenweb3.com`, `bvc.citizenweb3.com`, exact `https://t.me/web_3_society`. Поддомены и пути проходят |
| **M3** (community chat fallback) | Снести fallback цепь в approval.py:470. `_validate_response_payload` нормализует невалидный payload в `dm_request=False, dm_text=""` |
| **M4** (URLs in text) | Closed not applicable — модель в практике правило держит, YAGNI |
| **M5** (language conflict) | Drop `$language` field. Single source = модель смотрит на сообщение |
| **M6** (DM offer confirmation) | Conditional rule в follow_up.md: «applies only if offer visible in recent context as coming from Aida» |
| **Coverage** | Defer (повторно подтверждено после ревью). Контракт: открываем targeted unit-тесты на 4 конкретных trigger'а регрессии (см. план секция Coverage) |

---

## Critical do-not-touch list

- **H1 в коде уже работает.** Не возвращать `is_reply_to_us` в Qwen-API. Не возвращать прокидывание в `proactive.py`.
- **Decisions Round 2 — locked.** Не превращать в опциональные («может, лучше так?»). Если кажется, что какое-то решение ошибочно — спросить user'а явно, а не молча менять.
- **`audit_log` row создаётся в НАЧАЛЕ pipeline** (новый паттерн, не как сейчас). См. секцию `audit_id lifecycle` в плане. Это не косметика, это закрывает High 3 из ревью плана.
- **`tool_calls.audit_id` = FK ON DELETE CASCADE** на `audit_log(id)`. Не делать nullable.
- **Status field в audit_log** — обязательная часть schema migration (не отдельным шагом). Без него audit lifecycle не работает.
- **Redaction для `tool_calls`** — расширение существующих методов через `WHERE audit_id IN (SELECT ... FROM audit_log WHERE ...)`. Не дублировать retention policy в новом методе.
- **План в `docs/plans/2026-04-25-...md` — untracked.** При коммите Round 2 закоммитить вместе с остальным.

---

## Открытые вопросы (требуют user-confirmation после компакции)

1. **Коммит-стратегия.** Working tree содержит Round 1 работу нетронутой. Варианты:
   - (а) Один коммит на всё (Round 1 + Round 2 вместе). Просто, но огромный diff.
   - (б) Два коммита: «Rewrite Aida persona to trust-first per CW3 review» (Round 1) → «Iteration-1 round-2 fixes: tool logging, validators, prompt cleanups» (Round 2). Даёт revertability. Промежуточное состояние осмысленное.

   Моя рекомендация — (б). Спросить user'а перед коммитом #14.

2. **Branch.** План говорит `tg-growth-agent-llama`, реальность — `prompt-extraction-refactor`. Спросить: оставаться на `prompt-extraction-refactor` или мерджить/перебазировать на `tg-growth-agent-llama`. Не делать решение самостоятельно.

3. **Ordering #10/#11/#12.** Они marked параллельные, но все три вместе с #9 правят промпты+code. Если делаем по очереди — порядок безразличен. Если параллельно — внимательно с merge'ами на одних и тех же файлах (`responder.py`, `responder_verification.md`).

---

## Workflow для каждой таски

CLAUDE.md проекта требует:

- **Перед редактированием любого symbol'а** — `gitnexus_impact({target: "<symbolName>", direction: "upstream"})`. Доложить blast radius.
- **Перед коммитом** — `gitnexus_detect_changes()`.
- **Renaming** — через `gitnexus_rename` с dry_run сначала.

Маркировка таски: `TaskUpdate({taskId: "X", status: "in_progress"})` при старте, `completed` при завершении. Не batch'ить — сразу как сделал.

---

## Что делать первым после компакции

1. `TaskList` — увидеть все 8 тасок, начать с `#7`.
2. Прочитать секции из плана выше (порядок указан в «Что читать»).
3. Спросить user'а про **commit strategy** и **branch** (открытые вопросы выше) — до начала имплементации, чтобы не переделывать.
4. Старт `#7` → `gitnexus_impact` на затрагиваемые symbols в `src/storage/db.py` → миграция.
