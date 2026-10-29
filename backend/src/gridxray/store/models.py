from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from gridxray.store.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_demo: Mapped[bool] = mapped_column(default=False)
    meta_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # Fernet token, see apikeys.py
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InvestigationRun(Base):
    __tablename__ = "investigations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(40))
    seed: Mapped[int]
    budget: Mapped[int]
    status: Mapped[str] = mapped_column(String(16))  # running | done | failed | stopped
    events: Mapped[list] = mapped_column(JSON, default=list)
    score: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    session_key: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    language: Mapped[str] = mapped_column(String(5), default="en")
    usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    seal_nonce: Mapped[str | None] = mapped_column(String(64), nullable=True)  # revealed only when finished
    plan_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)  # initial plan: none | current | old | errors
    plan_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # when that plan was drawn (ISO date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Media(Base):
    """Pictures produced during an investigation (field-crew photos)."""

    __tablename__ = "media"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    content_type: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CustomGrid(Base):
    """A network designed by the user in the editor (see lab/custom.py)."""

    __tablename__ = "custom_grids"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_key: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(60))
    design: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
