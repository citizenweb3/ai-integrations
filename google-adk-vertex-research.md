# Google ADK и Vertex AI Agent Engine — Deep Research (апрель 2026)

**Researched:** 2026-04-25  
**ADK Python version:** 1.31.1 stable (21 апреля 2026) + 2.0.0b1 pre-release  
**ADK TypeScript:** 1.0 stable  
**ADK Go, Java:** stable

---

## 1. Google ADK

### Что такое

Open-source, code-first фреймворк для разработки AI-агентов от Google. Анонсирован на Google Cloud NEXT 2025. v1.0.0 достиг stable на Google I/O (май 2025). Сейчас — еженедельные релизы, активная разработка.

**Ключевая особенность архитектуры:** event-driven. Вместо request-response возвращает поток событий (`yield events`) — реалтайм-фидбек и полная observability.

### Типы агентов

| Тип | Класс | Движок | Поведение |
|-----|-------|--------|-----------|
| LLM Agent | `LlmAgent` / `Agent` | LLM | Недетерминированный, динамический routing |
| Sequential | `SequentialAgent` | Код | Выполняет sub-агентов по цепочке |
| Parallel | `ParallelAgent` | Код | Параллельное выполнение sub-агентов |
| Loop | `LoopAgent` | Код | Цикл до условия выхода |
| Custom | extends `BaseAgent` | Произвольный | Любая логика |

### Поддерживаемые LLM

Оптимизирован под Gemini, но не привязан:
- Google Gemini (все версии)
- Google Gemma (локально)
- Anthropic Claude
- OpenAI GPT
- Ollama (локальные модели)
- Любой OpenAI-совместимый endpoint через LiteLLM

### Hello World агент

```python
from google.adk.agents import Agent

def get_weather(city: str) -> str:
    """Get weather for a city."""
    return f"Weather in {city}: sunny, 25°C"

root_agent = Agent(
    model="gemini-2.5-flash",
    name="weather_agent",
    description="Answers weather questions.",
    instruction="You help users with weather information. Use the get_weather tool.",
    tools=[get_weather],  # Python функция автоматически становится tool
)
```

```bash
pip install google-adk
adk run my_agent   # терминал
adk web            # браузерный UI для отладки
```

### MCP интеграция — двусторонняя

**ADK как MCP-клиент:**
```python
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams, StreamableHTTPConnectionParams
from mcp import StdioServerParameters

# Локальный MCP сервер
agent = Agent(
    model="gemini-2.5-flash",
    name="fs_agent",
    tools=[McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])
        )
    )]
)

# Удалённый MCP сервер (HTTP/SSE)
agent = Agent(
    model="gemini-2.5-flash",
    tools=[McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url="https://mapstools.googleapis.com/mcp",
            headers={"X-Goog-Api-Key": "YOUR_KEY"}
        )
    )]
)
```

**ADK как MCP-сервер** — ADK инструменты экспортируются через `adk_to_mcp_tool_type` для других MCP клиентов.

### Gemini Live API в ADK

ADK имеет встроенный `run_live()` для голосовых/видео агентов:

```python
agent = Agent(
    model="gemini-2.0-flash-live-001",
    name="voice_agent",
    instruction="You are a helpful voice assistant.",
)
# runner.run_live() для стриминга
```

⚠️ **Известный баг (Issue #5018, апрель 2026):** ADK не поддерживает `gemini-3.1-flash-live-preview` — модель требует `send_realtime_input` вместо `send_client_content`. Workaround не реализован в 1.x ветке. Для новых live моделей — прямой WebSocket (как в geminilive.js).

---

## 2. Vertex AI Agent Engine

### Что такое

Fully managed serverless платформа для деплоя агентов в production. Поддерживает: ADK, LangChain, LangGraph, LlamaIndex, AG2, произвольный Python код.

### Что берёт на себя

| Cloud Run (DIY) | Agent Engine |
|-----------------|-------------|
| Управляешь контейнером | Serverless, 0 инфра |
| Session state сам | Sessions из коробки |
| Memory сам | Memory Bank из коробки |
| Observability сам | Cloud Trace/Logging встроено |
| Billing всегда | Billing только за активное время |

**Конкретные managed сервисы:**
- **Sessions** — хранение контекста разговора
- **Memory Bank** — долгосрочная память между сессиями (LLM-генерируемые)
- **Code Execution** — безопасный sandbox
- **RAG Engine** — встроенный retrieval с векторной БД
- **Evaluation Service** — тестирование и мониторинг качества
- **Agent Gateway** — API-to-agent bridge через Apigee
- **IAM + VPC** — доступ и изоляция стандартными GCP механизмами

### Деплой ADK агента

```python
import vertexai
from vertexai import agent_engines

vertexai.init(project="YOUR_PROJECT", location="us-central1")

remote_agent = agent_engines.create(
    agent_engine=root_agent,  # твой ADK Agent объект
    requirements=["google-adk==1.31.1"],
    display_name="My Production Agent",
)

# Использование
session = remote_agent.create_session(user_id="user123")
for event in remote_agent.stream_query(
    user_id="user123",
    session_id=session["id"],
    message="Hello!",
):
    print(event)
```

### Pricing (Vertex AI Agent Engine)

| Сервис | Free tier | Paid |
|--------|-----------|------|
| Compute (vCPU) | 180,000 vCPU-сек/мес | $0.0994/час |
| Memory (GiB) | 360,000 GiB-сек/мес | $0.0105/час |
| Sessions | — | $0.25 / 1,000 событий |
| Memory Bank хранение | — | $0.25 / 1,000 памятей/мес |
| Memory Bank retrieval | 1,000 записей/мес бесплатно | $0.50 / 1,000 записей |

**Реалистичный пример (10 RPS, 2vCPU/5GiB):**
- Runtime + Sessions + Memory Bank ≈ **$43,241/мес** (без LLM costs!)
- Для небольших нагрузок — кратно меньше. Idle не тарифицируется.

---

## 3. A2A Protocol

### Что такое

**Agent2Agent (A2A)** — открытый стандарт Google для коммуникации между агентами разных фреймворков и организаций.

- **MCP** = agent-to-tool
- **A2A** = agent-to-agent

**Статус:** v1.2 (март 2026). 150+ организаций в production.

### Как работает

**Agent Card** — каждый A2A агент публикует `/.well-known/agent-card.json` с capabilities и skills.

```python
# Экспортировать ADK агент как A2A сервер
from google.adk.a2a import A2AServer
A2AServer(agent=my_agent).start(port=8080)

# Подключить удалённый A2A агент как sub-agent
from google.adk.a2a import RemoteA2aAgent
remote = RemoteA2aAgent(name="remote_weather", url="https://weather-agent.example.com")
orchestrator = Agent(model="gemini-2.5-flash", sub_agents=[remote])
```

**Sub-agents vs A2A:**

| Сценарий | Рекомендация |
|----------|-------------|
| Агенты в одном процессе | Sub-agents |
| Агенты в разных сервисах/командах | A2A |
| Кросс-организационная интеграция | A2A |
| Разные фреймворки | A2A |

**Нативная поддержка A2A:** Google ADK, LangGraph, CrewAI, LlamaIndex, Semantic Kernel, AutoGen, Azure AI Foundry (Microsoft), SAP Joule, Zoom.

---

## 4. Сравнение с аналогами

| Критерий | Google ADK | LangGraph | CrewAI | AutoGen/AG2 |
|----------|-----------|-----------|--------|-------------|
| **Orchestration** | Иерархическое дерево | Граф состояний | Role-based crews | GroupChat |
| **LLM** | Gemini-optimized, другие через LiteLLM | Model-agnostic | Model-agnostic | Model-agnostic |
| **Языки** | Python, TS, Go, Java | Python | Python | Python |
| **Состояние/память** | Session + Memory services | Чекпойнты + time travel | Task outputs | In-memory |
| **Отладка** | ADK Web UI | LangSmith | Базовая | Базовая |
| **MCP** | Нативный (McpToolset) | Плагины | Плагины | Плагины |
| **A2A** | Нативный | Поддерживается | Поддерживается | Поддерживается |
| **Managed платформа** | Vertex AI Agent Engine | LangSmith (только мониторинг) | Нет | Нет |
| **GitHub stars** | ~13,100 | ~18,800 | — | — |
| **Monthly downloads** | ~1.2M | ~10.6M | — | — |
| **Status** | Активная разработка | Активная разработка | Активная | Maintenance mode |

---

## 5. Что production-ready, что ещё нет

### Готово к production

- Python ADK v1.x — stable, реальные кейсы (Renault, Box)
- TypeScript ADK v1.0 — stable
- Go и Java ADK — stable
- Agent Engine Runtime, Sessions, Memory Bank — GA с января 2026
- A2A v1.2 — 150+ организаций
- MCP интеграция (McpToolset) — stable
- Multi-agent (Sequential/Parallel) — stable
- Google Search Grounding — stable

### Экспериментальное / с проблемами

- **ADK Python 2.0** — пока beta (2.0.0b1)
- **Gemini 3.x + Live API** — ADK не успевает. `gemini-3.1-flash-live-preview` не работает с `run_live()` (Issue #5018)
- **TypeScript/Go/Java** — меньше примеров и документации
- **Agent Skills** — новая фича, документация неполная

### Болевые точки

1. **Model lag** — ADK обновляется медленнее новых Gemini моделей
2. **Non-Python SDK** — Go/Java/TypeScript функционально отстают
3. **Lock-in риск** — Agent Engine = только GCP
4. **Sessions дорогие** — при высоких нагрузках

---

## Итог

**ADK** — выбирать если: уже в Google Cloud / используешь Gemini / нужен multi-language / нужен нативный A2A / нужна managed платформа.

**Vs LangGraph:** ADK проще для старта, LangGraph лучше для сложных state machine и time-travel отладки.

**Agent Engine** — имеет смысл для production при умеренных нагрузках (не 10 RPS, там $43K/мес).

**A2A** — использовать когда агенты пересекают границы команд/организаций. Для монолита достаточно sub-agents.

**Для WorkorAI:** ADK пока не подходит для Gemini Live API с новейшими моделями (баг #5018) — нужен прямой WebSocket (geminilive.js паттерн).
