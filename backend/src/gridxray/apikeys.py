"""The Meta API key an account uses: one saved in the app (encrypted at rest) wins over backend/.env.

The key never goes back to the browser: only whether it is set, where it comes from and its last
four characters.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from gridxray.config import settings
from gridxray.store.models import User


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest()))


def encrypt(key: str) -> str:
    return _fernet().encrypt(key.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:  # SECRET_KEY changed since it was saved
        return None


def effective_key(user: User | None) -> tuple[str | None, str | None]:
    """(key, source): source is "app" (saved here), "env" (backend/.env) or None (missing)."""
    app_key = decrypt(user.meta_api_key_enc) if user is not None and user.meta_api_key_enc else None
    if app_key:
        return app_key, "app"
    if settings.meta_api_key:
        return settings.meta_api_key, "env"
    return None, None


def key_for_user(db: Session, user_id: int) -> str | None:
    return effective_key(db.get(User, user_id))[0]


def status(user: User) -> dict:
    key, source = effective_key(user)
    return {"configured": key is not None, "source": source,
            "hint": f"…{key[-4:]}" if key and source == "app" else None,
            "env_configured": bool(settings.meta_api_key)}
