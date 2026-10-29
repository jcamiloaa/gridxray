"""Networks designed by the user: save, validate, load as a scenario."""

import uuid

from fastapi import APIRouter, HTTPException, status

from gridxray.api.auth import CurrentUser, DbSession
from gridxray.api.investigations import Session, _key
from gridxray.lab import Complexity, generate_scenario
from gridxray.lab.custom import Design, build_custom, design_from_scenario, validate_design
from gridxray.store.models import CustomGrid

router = APIRouter(prefix="/grids", tags=["grids"])


def owned_grid(db, grid_id: str, user, session: str | None) -> CustomGrid:
    row = db.get(CustomGrid, grid_id)
    if row is None or row.user_id != user.id or (user.is_demo and row.session_key != _key(user, session)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Network not found")
    return row


def _checked(design: Design) -> Design:
    errors = validate_design(design)
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": errors})
    return design


def _summary(row: CustomGrid) -> dict:
    d = row.design
    return {"id": row.id, "name": row.name, "nodes": len(d.get("nodes", [])), "lines": len(d.get("lines", [])),
            "switches": sum(1 for ln in d.get("lines", []) if ln.get("switch")), "updated_at": row.updated_at}


@router.get("")
def list_grids(user: CurrentUser, db: DbSession, session: Session = None) -> list[dict]:
    q = db.query(CustomGrid).filter(CustomGrid.user_id == user.id)
    if user.is_demo:
        q = q.filter(CustomGrid.session_key == _key(user, session))
    return [_summary(r) for r in q.order_by(CustomGrid.updated_at.desc()).limit(50).all()]


@router.post("/validate")
def validate(design: Design, _: CurrentUser) -> dict:
    return {"errors": validate_design(design)}


@router.get("/template")
def template(_: CurrentUser, complexity: Complexity = Complexity.EASY, seed: int = 0) -> dict:
    """A generated network as an editable design (its real wiring), to start from."""
    s = generate_scenario(complexity, seed)
    return design_from_scenario(s, f"{complexity.value.capitalize()} {seed} (edited)").model_dump()


@router.post("", status_code=status.HTTP_201_CREATED)
def create(design: Design, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    _checked(design)
    row = CustomGrid(id=uuid.uuid4().hex, user_id=user.id, session_key=_key(user, session), name=design.name,
                     design=design.model_dump())
    db.add(row)
    db.commit()
    return _summary(row)


@router.get("/{grid_id}")
def get(grid_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    row = owned_grid(db, grid_id, user, session)
    return {**_summary(row), "design": row.design}


@router.put("/{grid_id}")
def update(grid_id: str, design: Design, user: CurrentUser, db: DbSession, session: Session = None) -> dict:
    row = owned_grid(db, grid_id, user, session)
    _checked(design)
    row.name, row.design = design.name, design.model_dump()
    db.commit()
    return _summary(row)


@router.delete("/{grid_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(grid_id: str, user: CurrentUser, db: DbSession, session: Session = None) -> None:
    db.delete(owned_grid(db, grid_id, user, session))
    db.commit()


@router.post("/{grid_id}/scenario")
def scenario(grid_id: str, user: CurrentUser, db: DbSession, session: Session = None, seed: int = 0) -> dict:
    """The designed network as the agents will see it: inventory and meter readings, no wiring."""
    row = owned_grid(db, grid_id, user, session)
    s = build_custom(Design(**row.design), seed, f"custom:{row.id}")
    return {"seed": seed, "source": s.source, "name": row.name, **s.observable().to_dict()}


@router.post("/{grid_id}/truth")
def truth(grid_id: str, user: CurrentUser, db: DbSession, session: Session = None, seed: int = 0) -> dict:
    row = owned_grid(db, grid_id, user, session)
    return {"truth": build_custom(Design(**row.design), seed, f"custom:{row.id}").reveal()}
