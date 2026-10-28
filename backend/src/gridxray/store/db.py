from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from gridxray.config import settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    if url.startswith("sqlite"):  # tests
        if ":memory:" in url:  # one shared in-memory database
            return create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
        # a file gives each thread its own connection, so background runs never share one with the test
        return create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
    return create_engine(url, pool_pre_ping=True)


engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def init_db() -> None:
    """Create tables. Fine for the hackathon; switch to Alembic once the schema settles."""
    from gridxray.store import models  # noqa: F401  (register models)

    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":  # columns added after the table first shipped
        from sqlalchemy import text

        with engine.begin() as conn:
            for ddl in ("session_key VARCHAR(32)", "language VARCHAR(5) DEFAULT 'en'", "usage JSON", "seal_nonce VARCHAR(64)"):
                conn.execute(text(f"ALTER TABLE investigations ADD COLUMN IF NOT EXISTS {ddl}"))
