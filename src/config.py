"""Configuration loader — YAML config + environment variable overrides."""
import yaml
import socket
from pathlib import Path
from os import environ


def _in_docker() -> bool:
    return Path("/.dockerenv").exists()


def _default_host() -> str:
    """Use host.docker.internal inside Docker, localhost otherwise."""
    if _in_docker():
        return "host.docker.internal"
    try:
        socket.getaddrinfo("host.docker.internal", None)
        return "host.docker.internal"
    except socket.gaierror:
        return "localhost"

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
        or f"http://{_default_host()}:3000"
    )
    config["validatorinfo"]["rag_api_token"] = environ.get("RAG_API_TOKEN") or dotenv.get("RAG_API_TOKEN", "")
    config["validatorinfo"]["database_url"] = environ.get("DATABASE_URL") or dotenv.get("DATABASE_URL", "")

    config.setdefault("ollama", {})
    config["ollama"]["token"] = (
        environ.get("OLLAMA_TOKEN")
        or dotenv.get("OLLAMA_TOKEN")
        or config["ollama"].get("token", "")
    )

    # Vertex: project/location from env (preferred) or .env; location can also come
    # from the yaml `vertex` block. Credentials are ADC via GOOGLE_APPLICATION_CREDENTIALS.
    config.setdefault("vertex", {})
    config["vertex"]["project"] = environ.get("GOOGLE_CLOUD_PROJECT") or dotenv.get("GOOGLE_CLOUD_PROJECT", "")
    config["vertex"]["location"] = (
        environ.get("GOOGLE_CLOUD_LOCATION")
        or dotenv.get("GOOGLE_CLOUD_LOCATION")
        or config["vertex"].get("location", "us-central1")
    )

    # The in-process tools (query_validatorinfo, search_rag), the genai client, and
    # assert_vertex_env() all read os.environ directly. Mirror resolved values there so
    # local `.env` runs behave like docker-compose (real env always wins via setdefault).
    for _key in ("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION",
                 "GOOGLE_APPLICATION_CREDENTIALS", "OLLAMA_TOKEN"):
        _val = dotenv.get(_key)
        if _val:
            environ.setdefault(_key, _val)
    if config["validatorinfo"]["rag_api_url"]:
        environ.setdefault("RAG_API_URL", config["validatorinfo"]["rag_api_url"])
    if config["validatorinfo"]["rag_api_token"]:
        environ.setdefault("RAG_API_TOKEN", config["validatorinfo"]["rag_api_token"])
    if config["validatorinfo"]["database_url"]:
        environ.setdefault("DATABASE_URL", config["validatorinfo"]["database_url"])
    environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")

    config["telegram"]["session"] = environ.get("TELEGRAM_SESSION") or dotenv.get("TELEGRAM_SESSION", "")

    return config
