"""Configuration helpers and environment loading."""

from pathlib import Path

from dotenv import load_dotenv


def load_environment() -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    load_dotenv(backend_dir / ".env")
