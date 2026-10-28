"""Pictures of an investigation, stored in the database next to its log."""

import uuid

from gridxray.store.db import SessionLocal
from gridxray.store.models import Media


def save(run_id: str, data: bytes, content_type: str = "image/jpeg") -> str:
    mid = uuid.uuid4().hex
    with SessionLocal() as db:
        db.add(Media(id=mid, run_id=run_id, content_type=content_type, data=data))
        db.commit()
    return mid


def load(run_id: str, media_id: str) -> Media | None:
    with SessionLocal() as db:
        m = db.get(Media, media_id)
        if m is None or m.run_id != run_id:
            return None
        db.expunge(m)
        return m
