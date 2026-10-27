"""Meter model: noise, missing readings and faulty sensors on top of the power-flow results."""

from dataclasses import dataclass, field

import numpy as np
import pandapower as pp


@dataclass(frozen=True)
class SensorModel:
    voltage_noise_pu: float  # gaussian std on |V|
    power_noise_rel: float  # relative gaussian std on P and Q
    missing_rate: float  # probability a reading is lost
    faulty_meters: dict[int, str] = field(default_factory=dict)  # node -> "stuck" | "biased"


def read_meters(
    net: pp.pandapowerNet, metered: list[int], model: SensorModel, rng: np.random.Generator,
) -> dict[int, dict[str, float | None]]:
    """One reading per metered node: voltage magnitude (pu) and net load P/Q (kW, kvar)."""
    load_p = net.load.groupby("bus").p_mw.sum() * 1000
    load_q = net.load.groupby("bus").q_mvar.sum() * 1000
    readings: dict[int, dict[str, float | None]] = {}
    for node in metered:
        if rng.random() < model.missing_rate:
            readings[node] = {"vm_pu": None, "p_kw": None, "q_kvar": None}
            continue
        vm = float(net.res_bus.vm_pu.at[node]) + rng.normal(0, model.voltage_noise_pu)
        match model.faulty_meters.get(node):
            case "stuck":
                vm = 1.0
            case "biased":
                vm += 0.015
        p = float(load_p.get(node, 0.0))
        q = float(load_q.get(node, 0.0))
        readings[node] = {
            "vm_pu": round(vm, 5),
            "p_kw": round(p * (1 + rng.normal(0, model.power_noise_rel)), 2),
            "q_kvar": round(q * (1 + rng.normal(0, model.power_noise_rel)), 2),
        }
    return readings
