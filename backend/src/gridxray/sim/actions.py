"""Experiment actions the agent may request. Executed only inside the simulator."""

from typing import Literal

from pydantic import BaseModel, Field


class PerturbLoad(BaseModel):
    action: Literal["perturb_load"] = "perturb_load"
    node: int
    delta_kw: float = Field(ge=-20, le=20)
    delta_kvar: float = Field(default=0.0, ge=-10, le=10)


class ToggleSwitch(BaseModel):
    action: Literal["toggle_switch"] = "toggle_switch"
    switch_id: int


class Snapshot(BaseModel):
    action: Literal["snapshot"] = "snapshot"
    hour: int = Field(ge=0, le=23)


Action = PerturbLoad | ToggleSwitch | Snapshot
