from sqlalchemy import select
from sqlalchemy.orm import Session

from gridxray.auth.security import hash_password, verify_password
from gridxray.config import settings
from gridxray.store.models import User


def authenticate(session: Session, email: str, password: str) -> User | None:
    user = session.scalar(select(User).where(User.email == email.lower()))
    if user and verify_password(password, user.password_hash):
        return user
    return None


def get_demo_user(session: Session) -> User | None:
    return session.scalar(select(User).where(User.is_demo.is_(True)))


def ensure_demo_user(session: Session) -> User:
    """Create the demo account, or sync it with the configured credentials."""
    user = get_demo_user(session)
    if user is None:
        user = User(email="", name="", password_hash="", is_demo=True)
        session.add(user)
    user.email = settings.demo_user_email.lower()
    user.name = settings.demo_user_name
    if not verify_password(settings.demo_user_password, user.password_hash):
        user.password_hash = hash_password(settings.demo_user_password)
    session.commit()
    return user
