from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_ROOT / ".env", extra="ignore")
    runtime_mode: Literal["cloud", "local_demo", "codex_cli"] = "cloud"
    database_url: str = ""
    dashscope_api_key: SecretStr = SecretStr("")
    api_token: SecretStr = SecretStr("")
    owner_id: str = "local-user"
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    chat_model: str = "qwen-plus"
    extract_model: str = "qwen-flash"
    embedding_model: str = "text-embedding-v4"
    embedding_dimensions: int = 1024
    rerank_model: str = "qwen3-rerank"
    rerank_url: str = (
        "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
    )
    search_model: str = "qwen-plus"
    search_url: str = (
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
    )
    storage_dir: str = ".data"
    auto_migrate: bool = True
    worker_enabled: bool = True
    memory_v2_enabled: bool = False
    memory_budget_fast: int = 800
    memory_budget_personalized: int = 1600
    memory_budget_deep: int = 3200
    memory_budget_max: int = 6400
    retrieval_rounds_max: int = 3
    model_context_limit: int = 32768
    model_output_reserve: int = 4096
    model_tool_reserve: int = 2048
    emotion_recheck_minutes: int = 30
    memory_write_debounce_seconds: float = 3.0
    intent_planner_enabled: bool = False
    max_rounds: int = 6
    max_tools: int = 12
    run_timeout: float = 120
    context_chars: int = 24000
    memory_retrieval_policy: Literal["legacy", "v2"] = "legacy"
    agent_trace_enabled: bool = True
    memory_vector_min: float = 0.35
    memory_vector_strong: float = 0.70
    memory_lexical_min: float = 0.50
    memory_rerank_min: float = 0.45
    memory_result_limit: int = 6
    memory_budget: int = 1500
    max_file_bytes: int = 20 * 1024 * 1024

    @property
    def storage(self):
        return (API_ROOT / self.storage_dir).resolve()


settings = Settings()
