"""FastAPI app factory and route registration."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.quiz import router as quiz_router
from app.core.config import load_environment
from app.core.preflight import assert_preflight_passes

load_environment()
assert_preflight_passes()

app = FastAPI(title="demo-proj auth")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(quiz_router)
