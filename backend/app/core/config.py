from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Azure Speech Services
    azure_speech_key: str = ""
    azure_speech_region: str = "canadacentral"

    # OpenAI
    openai_api_key: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_key: str = ""

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Redis (for distributed locks/rate limits)
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = False
    session_lock_ttl_seconds: int = 60 * 30
    session_lock_heartbeat_seconds: int = 15

    # Admin
    admin_email: str = ""

    # App
    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
