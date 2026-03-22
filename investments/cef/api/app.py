import os
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from dotenv import load_dotenv

from ..database import init_db
from .routes import funds, prices, holdings, distributions, screener, nav_history, imports

load_dotenv()

STATIC_DIR = Path(__file__).parent.parent / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="CEF Tracker")

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        token = os.getenv("CEF_AUTH_TOKEN", "")
        if token and request.url.path.startswith("/api/"):
            auth_header = request.headers.get("Authorization", "")
            if auth_header != f"Bearer {token}":
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

    init_db()

    app.include_router(funds.router, prefix="/api/funds")
    app.include_router(prices.router, prefix="/api/prices")
    app.include_router(holdings.router, prefix="/api/holdings")
    app.include_router(distributions.router, prefix="/api/distributions")
    app.include_router(screener.router, prefix="/api/screener")
    app.include_router(nav_history.router, prefix="/api/nav_history")
    app.include_router(imports.router, prefix="/api/imports")

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        return FileResponse(str(STATIC_DIR / "index.html"))

    return app
