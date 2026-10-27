"""HTTP API. Investigation streaming over SSE lands on D6."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from gridxray import __version__
from gridxray.api.auth import CurrentUser
from gridxray.api.auth import router as auth_router
from gridxray.api.investigations import router as investigations_router
from gridxray.auth.service import ensure_demo_user
from gridxray.lab import Complexity, Reference, generate_scenario, load_reference
from gridxray.store.db import SessionLocal, init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as session:
        ensure_demo_user(session)
    from gridxray.runs import manager

    resumed = manager.resume_interrupted()  # investigations cut short by a restart carry on
    if resumed:
        print(f"Resumed {resumed} interrupted investigation(s)", flush=True)
    yield


app = FastAPI(title="GridXray", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"],
    allow_headers=["*"], allow_credentials=True,
)
app.include_router(auth_router)
app.include_router(investigations_router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/docs")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.post("/scenarios")
def create_scenario(
    _: CurrentUser,
    complexity: Complexity = Complexity.EASY,
    seed: int = 0,
    reference: Reference | None = None,
) -> dict:
    """Generate a scenario (or load a reference network) and return only its observable view."""
    s = load_reference(reference, seed) if reference else generate_scenario(complexity, seed)
    return {"seed": seed, "source": s.source, **s.observable().to_dict()}


@app.post("/scenarios/truth")
def scenario_truth(
    _: CurrentUser,
    complexity: Complexity = Complexity.EASY,
    seed: int = 0,
    reference: Reference | None = None,
) -> dict:
    """Ground truth for a scenario (scenarios are deterministic per seed). For the reveal step only."""
    s = load_reference(reference, seed) if reference else generate_scenario(complexity, seed)
    return {"truth": s.reveal()}


@app.get("/evidence")
def evidence_page(_: CurrentUser) -> dict:
    """Signed-in users only: benchmark, test results, guarantees, scoring method and live statistics."""
    from sqlalchemy import func

    from gridxray.evidence import evidence
    from gridxray.store.models import InvestigationRun

    with SessionLocal() as db:
        rows = db.query(InvestigationRun.source, InvestigationRun.status, func.count()).group_by(
            InvestigationRun.source, InvestigationRun.status).all()
        done = db.query(InvestigationRun).filter(InvestigationRun.status == "done").all()
    f1 = {}
    for r in done:
        g = (r.score or {}).get("gridxray")
        if g:
            f1.setdefault(r.source, []).append(g["f1"])
    live = [{"source": s, "status": st, "count": c} for s, st, c in rows]
    live_f1 = [{"source": s, "runs": len(v), "mean_f1": round(sum(v) / len(v), 3)} for s, v in f1.items()]
    return evidence(live) | {"live_f1": live_f1}


@app.get("/showcase")
def showcase() -> dict:
    """Public example network WITH its topology, for the landing-page illustration."""
    s = generate_scenario(Complexity.MEDIUM, seed=7)
    return {"source": s.source, **s.observable().to_dict(), "truth": s.reveal()}
