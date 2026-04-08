# Рефакторинг: модульная структура src/

## Текущее

14 файлов в плоском src/. Нет группировки.

## Новая структура

```
src/
├── __init__.py
├── config.py                  # остаётся на месте (корневой)
├── telegram/                  # работа с Telegram API
│   ├── __init__.py
│   ├── listener.py
│   ├── sender.py
│   ├── approval.py
│   └── joiner.py
├── ai/                        # Claude + RAG + proactive
│   ├── __init__.py
│   ├── responder.py
│   ├── rag.py
│   └── proactive.py
├── data/                      # хранилище и данные
│   ├── __init__.py
│   ├── db.py
│   ├── contacts.py
│   ├── cleanup.py
│   └── validatorinfo.py
└── core/                      # shared logic
    ├── __init__.py
    └── rate_limiter.py
```

## Что меняется

1. Файлы перемещаются в подпапки (содержимое НЕ меняется)
2. __init__.py в каждой папке — пустой или с re-exports
3. main.py — обновить все импорты
4. Нет кросс-импортов внутри src/ — все зависимости через main.py DI

## Импорты в main.py (новые)

```python
from src.config import load_config
from src.data.db import Database
from src.ai.rag import RAGClient
from src.data.validatorinfo import ValidatorInfoAdapter
from src.ai.responder import Responder
from src.core.rate_limiter import RateLimiter
from src.telegram.sender import Sender
from src.data.contacts import ContactManager
from src.data.cleanup import CleanupManager
from src.telegram.listener import Listener
from src.telegram.approval import ApprovalBot
from src.ai.proactive import ProactiveScanner
from src.telegram.joiner import Joiner
```

## Задачи

1. Создать директории + __init__.py
2. Переместить файлы
3. Обновить main.py импорты
4. Проверить syntax + запуск
