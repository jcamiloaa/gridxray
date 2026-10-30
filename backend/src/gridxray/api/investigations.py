"""Start investigations and stream them live (Server-Sent Events)."""

import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Cookie, Header, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from gridxray.api.auth import DEVICE_COOKIE, CurrentUser, DbSession
from gridxray.config import settings
from gridxray.lab import Complexity, Reference
from gridxray.pricing import PRICES
from gridxray.runs import manager, run_summary, session_key, usage_totals
from gridxray.store.models import CustomGrid, InvestigationRun

router = APIRouter(prefix="/investigations", tags=["investigations"])
MAX_CONCURRENT = 4  # protects the Meta Model API quota during judging


class StartRequest(BaseModel):
    complexity: Complexity = Complexity.EASY
    reference: Reference | None = None
    grid: str | None = Field(default=None, max_length=32)  # a network designed in the editor
    seed: int = 0
    budget: int = Field(default=10, ge=0, le=40)  # 0 = autonomous: the planning agent decides
    language: str = Field(default="en", pattern="^(en|es)$")
    plan: str = Field(default="none", pattern="^(none|current|old|errors)$")  # the utility's initial plan
    plan_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


Session = Annotated[str | None, Cookie(alias=DEVICE_COOKIE)]  # the browser, so sign-out keeps your runs


def _key(user, session: str | None) -> str | None:
    # the shared demo account is used by many people at once: runs belong to the browser session
    return session_key(session) if user.is_demo else None


def _owned(db, run_id: str, user, session: str | None) -> InvestigationRun:
    row = db.get(InvestigationRun, run_id)
    if row is None or row.user_id != user.id or (user.is_demo and row.session_key != _key(user, session)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Investigation not found")
    return row


@router.post("", status_code=status.HTTP_201_CREATED)
def start(body: StartRequest, user: CurrentUser, session: Session = None) -> dict:
    from gridxray.apikeys import effective_key

    if effective_key(user)[0] is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "No Meta API key: add it in Usage & settings (or META_API_KEY in backend/.env)")
    key = _key(user, session)
    if manager.active_for(user.id, key):
        raise HTTPException(status.HTTP_409_CONFLICT, "An investigation is already running in this session")
    if manager.running_count() >= MAX_CONCURRENT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Several investigations are running; try again in a few minutes")
    source = body.reference.value if body.reference else body.complexity.value
    if body.grid:
        from gridxray.api.grids import owned_grid
        from gridxray.store.db import SessionLocal

        with SessionLocal() as db:
            source = f"custom:{owned_grid(db, body.grid, user, session).id}"
    run = manager.start(user.id, source, body.seed, body.budget, key, body.language, body.plan, body.plan_date)
    return {"id": run.id, "source": source, "seed": body.seed, "budget": body.budget}


@router.get("")
def list_runs(user: CurrentUser, db: DbSession, session: Session = None) -> list[dict]:
    """Every investigation of this account (or browser session, for the demo account), newest first."""
    q = db.query(InvestigationRun).filter(InvestigationRun.user_id == user.id)
    if user.is_demo:
        q = q.filter(InvestigationRun.session_key == _key(user, session))
    rows = q.order_by(InvestigationRun.created_at.desc()).limit(50).all()
    # a designed network shows its own name, not its database id
    ids = {r.source.split(":", 1)[1] for r in rows if r.source.startswith("custom:")}
    names = {g.id: g.name for g in db.query(CustomGrid).filter(CustomGrid.id.in_(ids))} if ids else {}
    return [run_summary(manager.runs.get(r.id) or r) | {"created_at": r.created_at,
            "network": names.get(r.source.split(":", 1)[1]) if r.source.startswith("custom:") else None} for r in rows]


@router.get("/active")
def active(user: CurrentUser, session: Session = None) -> dict | None:
    """The investigation running in this session, so a reloaded page can reattach to it."""
    run = manager.active_for(user.id, _key(user, session))
    if run is None:
        return None
    return {"id": run.id, "source": run.source, "seed": run.seed, "budget": run.budget}


@router.get("/usage")
def usage(user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    """Tokens and cost of this account's (or demo session's) investigations, with the price table."""
    q = db.query(InvestigationRun).filter(InvestigationRun.user_id == user.id)
    if user.is_demo:
        q = q.filter(InvestigationRun.session_key == _key(user, session))
    rows = [{"usage": (manager.runs[r.id].usage if r.id in manager.runs else r.usage)} for r in q.all()]
    return {"runs": len(rows), **usage_totals(rows), "prices": PRICES,
            "models": {"spark": settings.spark_model, "wonder": settings.wonder_model}}


@router.post("/{run_id}/stop")
def stop(run_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    _owned(db, run_id, user, session)
    if not manager.stop(run_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "This investigation is not running")
    return {"stopping": True}


@router.post("/{run_id}/resume")
def resume(run_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    row = _owned(db, run_id, user, session)
    if row.status in ("running", "done"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"This investigation is {row.status}")
    if manager.active_for(user.id, _key(user, session)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Another investigation is running in this session")
    db.expunge(row)
    run = manager.resume(row)
    return {"id": run.id, "source": run.source, "seed": run.seed, "budget": run.budget}


@router.get("/{run_id}")
def get(run_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    row = _owned(db, run_id, user, session)
    live = manager.runs.get(run_id)
    src = live or row
    return {"id": row.id, "status": src.status, "events": live.since(0) if live else row.events, "score": src.score,
            "source": row.source, "seed": row.seed, "budget": row.budget}


class InterveneRequest(BaseModel):
    switches: list[int] = Field(default_factory=list, max_length=6)  # switches to operate (toggle)
    meters_off: list[int] = Field(default_factory=list, max_length=10)  # meters that go offline


@router.get("/{run_id}/field")
def field(run_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    """Live intervention panel: the real switch positions and meters of a running investigation."""
    _owned(db, run_id, user, session)
    view = manager.field_view(run_id)
    if view is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This investigation is not running")
    return view


@router.post("/{run_id}/intervene")
def intervene(run_id: str, body: InterveneRequest, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    """Change the real network while the AI investigates; it is not told and must notice from the readings."""
    _owned(db, run_id, user, session)
    if not body.switches and not body.meters_off:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a switch to operate or a meter to switch off")
    problem = manager.intervene(run_id, body.switches, body.meters_off)
    if problem:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Not applied: {problem}")
    return {"applied": True}


@router.get("/{run_id}/truth")
def run_truth(run_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    """The real network at the end of this run (field interventions included) and the one sealed at the start."""
    from gridxray.runs import apply_interventions, make_scenario

    row = _owned(db, run_id, user, session)
    live = manager.runs.get(run_id)
    if (live.status if live else row.status) == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "The real network is revealed when the investigation has finished")
    events = live.since(0) if live else row.events
    s = make_scenario(row.source, row.seed)
    initial = sorted(s.true_edges)
    changed = apply_interventions(s, events)
    return {"truth": s.reveal(), "initial_edges": initial, "interventions": changed}


@router.get("/{run_id}/seal")
def seal(run_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    """After the run: the nonce and the topology, so the browser can re-check the published commitment."""
    from gridxray.runs import make_scenario
    from gridxray.seal import ALGORITHM, canonical, commitment

    row = _owned(db, run_id, user, session)
    live = manager.runs.get(run_id)
    status_now = live.status if live else row.status
    if status_now == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "The seal opens only when the investigation has finished")
    if not row.seal_nonce:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This investigation predates sealing")
    text = canonical(make_scenario(row.source, row.seed))
    sealed = next((e for e in (live.since(0) if live else row.events) if e.get("kind") == "sealed"), {})
    return {"algorithm": ALGORITHM, "nonce": row.seal_nonce, "canonical": text,
            "published_commitment": sealed.get("commitment"), "recomputed": commitment(row.seal_nonce, text)}


@router.get("/{run_id}/media/{media_id}")
def media_file(run_id: str, media_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> Response:
    """A field-crew photo of this investigation."""
    from gridxray import media

    _owned(db, run_id, user, session)
    m = media.load(run_id, media_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such picture")
    return Response(m.data, media_type=m.content_type, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/{run_id}/report", response_class=HTMLResponse)
def report(run_id: str, user: CurrentUser, db: DbSession, session: Session = None, lang: str | None = None) -> HTMLResponse:
    """Printable end-of-investigation report."""
    from gridxray.report import render

    row = _owned(db, run_id, user, session)
    live = manager.runs.get(run_id)
    if live:  # include events that may not have been flushed yet
        row.events, row.score, row.usage = live.since(0), live.score, live.usage
    return HTMLResponse(render(row, lang))


@router.get("/{run_id}/events")
async def events(run_id: str, user: CurrentUser, db: DbSession, session: Session = None, since: int = 0,
                 last_event_id: Annotated[str | None, Header()] = None) -> EventSourceResponse:
    """Every event carries its position as the SSE id, so a dropped connection resumes where it left off."""
    row = _owned(db, run_id, user, session)
    start = max(since, int(last_event_id) if last_event_id and last_event_id.isdigit() else 0)
    live = manager.runs.get(run_id)
    if live is None or live.status != "running":
        stored = list(live.since(0) if live else row.events)

        async def replay():
            for i, e in enumerate(stored[start:], start + 1):
                yield {"id": str(i), "event": e["kind"], "data": json.dumps(e, default=str)}

        return EventSourceResponse(replay())

    async def stream():
        sent = start
        while True:
            for e in live.since(sent):
                sent += 1
                yield {"id": str(sent), "event": e["kind"], "data": json.dumps(e, default=str)}
                if e["kind"] == "done":
                    return
            await asyncio.sleep(0.25)

    return EventSourceResponse(stream(), ping=15)
