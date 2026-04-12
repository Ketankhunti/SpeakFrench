from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import session, payments, health

app = FastAPI(
    title="SpeakFrench API",
    description="Backend API for TCF/TEF French speaking practice",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(session.router, prefix="/api/session", tags=["session"])
app.include_router(payments.router, prefix="/api/payments", tags=["payments"])
