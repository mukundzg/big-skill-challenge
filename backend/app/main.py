"""FastAPI app factory and route registration."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.quiz import router as quiz_router
from app.core.app_logger import configure_logging, log_error, shutdown_logging
from app.core.config import load_environment
from app.core.preflight import assert_preflight_passes

load_environment()
configure_logging()
assert_preflight_passes()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    shutdown_logging()


app = FastAPI(title="demo-proj auth", lifespan=_lifespan)
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
app.include_router(admin_router)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    log_error("Unhandled API exception", exc=exc, path=str(request.url.path), method=request.method)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
