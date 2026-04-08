"""Configuration loader — YAML config + environment variable overrides."""
import yaml
from pathlib import Path
from os import environ

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
ENV_PATH = Path(__file__).parent.parent / ".env"


def _load_dotenv() -> dict[str, str]:
    """Minimal .env loader for local runs outside docker-compose."""
    if not ENV_PATH.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in ENV_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)
    dotenv = _load_dotenv()

    # Env overrides for secrets (NEVER stored in files)
    config.setdefault("telegram", {})
    config["telegram"]["api_id"] = int(environ.get("TELEGRAM_API_ID") or dotenv.get("TELEGRAM_API_ID", 0))
    config["telegram"]["api_hash"] = environ.get("TELEGRAM_API_HASH") or dotenv.get("TELEGRAM_API_HASH", "")
    config["telegram"]["bot_token"] = environ.get("TELEGRAM_BOT_TOKEN") or dotenv.get("TELEGRAM_BOT_TOKEN", "")
    config["telegram"]["approval_chat_id"] = int(environ.get("APPROVAL_CHAT_ID") or dotenv.get("APPROVAL_CHAT_ID", 0))

    # External services
    config.setdefault("validatorinfo", {})
    config["validatorinfo"]["rag_api_url"] = (
        environ.get("RAG_API_URL")
        or dotenv.get("RAG_API_URL")
        or "http://host.docker.internal:3000"
    )
    config["validatorinfo"]["rag_api_token"] = environ.get("RAG_API_TOKEN") or dotenv.get("RAG_API_TOKEN", "")
    config["validatorinfo"]["database_url"] = environ.get("DATABASE_URL") or dotenv.get("DATABASE_URL", "")

    return config
