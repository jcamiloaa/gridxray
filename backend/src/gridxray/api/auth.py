import secrets
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from gridxray.auth.security import create_session_token, read_session_token
from gridxray.auth.service import authenticate, get_demo_user
from gridxray.config import settings
from gridxray.store.db import get_session
from gridxray.store.models import User

COOKIE_NAME = "gridxray_session"
# identifies the browser, not the sign-in: survives sign-out so demo users keep their investigations
DEVICE_COOKIE = "gridxray_device"

router = APIRouter(prefix="/auth", tags=["auth"])
DbSession = Annotated[Session, Depends(get_session)]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    is_demo: bool


def _start_session(response: Response, user: User, device: str | None = None) -> UserOut:
    response.set_cookie(
        COOKIE_NAME, create_session_token(user.id), max_age=settings.session_hours * 3600,
        httponly=True, samesite="lax", secure=settings.cookie_secure, path="/",
    )
    if not device:
        response.set_cookie(DEVICE_COOKIE, secrets.token_hex(16), max_age=365 * 24 * 3600,
                            httponly=True, samesite="lax", secure=settings.cookie_secure, path="/")
    return UserOut(id=user.id, email=user.email, name=user.name, is_demo=user.is_demo)


def current_user(
    session: DbSession, token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> User:
    user_id = read_session_token(token) if token else None
    user = session.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


@router.post("/login")
def login(body: LoginRequest, response: Response, session: DbSession,
          device: Annotated[str | None, Cookie(alias=DEVICE_COOKIE)] = None) -> UserOut:
    user = authenticate(session, body.email, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _start_session(response, user, device)


@router.post("/demo")
def demo_login(response: Response, session: DbSession,
               device: Annotated[str | None, Cookie(alias=DEVICE_COOKIE)] = None) -> UserOut:
    """One-click sign-in with the demo account."""
    user = get_demo_user(session)
    if user is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Demo account not available")
    return _start_session(response, user, device)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
def me(user: CurrentUser) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name, is_demo=user.is_demo)
