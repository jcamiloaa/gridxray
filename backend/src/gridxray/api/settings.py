"""Account settings: the Meta API key used for this account's investigations."""

import openai
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from gridxray import apikeys
from gridxray.api.auth import CurrentUser, DbSession
from gridxray.config import settings

router = APIRouter(prefix="/settings", tags=["settings"])


class KeyRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)


def check_key(key: str) -> None:
    """One tiny Spark call: proves the key works before it is saved."""
    from gridxray.agent.client import MetaClient

    try:
        MetaClient(api_key=key, timeout=60).respond(settings.spark_model, "Reply with OK.", reasoning_effort="low")
    except openai.AuthenticationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Meta rejected this API key") from e
    except openai.PermissionDeniedError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This API key has no access to the Muse models") from e
    except openai.APIError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not verify the key with the Meta API: {e}") from e


@router.get("/meta-key")
def key_status(user: CurrentUser) -> dict:
    return apikeys.status(user)


@router.put("/meta-key")
def save_key(body: KeyRequest, user: CurrentUser, db: DbSession) -> dict:
    key = body.api_key.strip()
    check_key(key)
    user.meta_api_key_enc = apikeys.encrypt(key)
    db.commit()
    return apikeys.status(user)


@router.delete("/meta-key")
def delete_key(user: CurrentUser, db: DbSession) -> dict:
    user.meta_api_key_enc = None
    db.commit()
    return apikeys.status(user)
