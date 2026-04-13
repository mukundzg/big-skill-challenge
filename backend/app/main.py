"""FastAPI app factory and route registration."""

import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.content_eval import router as content_eval_router
from app.api.routes.health import router as health_router
from app.api.routes.quiz import router as quiz_router
from app.core.app_logger import (
    apply_stderr_traceback_suppression,
    configure_logging,
    log_error_with_traceback,
    log_warn,
    shutdown_logging,
)
from app.core.config import load_environment
from app.core.preflight import assert_preflight_passes

load_environment()
configure_logging()
# Preflight runs in lifespan (below), not at import time — so `from app.main import app`
# returns immediately and cannot hang on DB/Gemini during a plain import smoke test.


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Uvicorn configures stdlib logging after import; re-apply so stderr stays one-line (no stack dumps).
    apply_stderr_traceback_suppression()
    # Blocks here only when the ASGI server starts (uvicorn/hypercorn), not on `import app.main`.
    try:
        assert_preflight_passes()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        raise
    except Exception as e:
        # Bug or unexpected raise inside a check (normal failures call sys.exit(1) in preflight).
        log_error_with_traceback("Unexpected error during preflight", e)
        sys.exit(1)
    yield
    from app.services.content_resolver.endpoint_service import shutdown_content_resolver

    shutdown_content_resolver()
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
app.include_router(content_eval_router)


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    log_warn(
        "Request validation failed",
        path=str(request.url.path),
        method=request.method,
        errors=exc.errors(),
    )
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    log_error_with_traceback(
        "Unhandled API exception",
        exc,
        path=str(request.url.path),
        method=request.method,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
