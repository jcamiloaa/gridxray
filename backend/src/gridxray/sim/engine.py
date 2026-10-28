"""Runs virtual experiments on a scenario and reports only what meters would show.

Every experiment is temporary: the network is restored afterwards. Results are
before/after deltas of averaged meter readings, so constant meter bias cancels while
random noise, missing readings and faulty meters still get through.
"""

from dataclasses import asdict, dataclass, field

import numpy as np
import pandapower as pp

from gridxray.lab import Scenario

V_MIN, V_MAX = 0.9, 1.1
MAX_LOADING = 100.0  # percent
MAX_DELTA_KW = 3000.0


@dataclass
class ExperimentRecord:
    id: int
    action: dict
    accepted: bool
    message: str
    cost: int = 0
    # node id -> voltage change in pu (after - before); None when the meter gave no data
    delta_vm: dict[int, float | None] = field(default_factory=dict)
    delta_p_kw: float = 0.0
    # why it was rejected, as data: {"limit", "value", "threshold", "safe_kw"?}; None when accepted
    rejection: dict | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class ExperimentEngine:
    def __init__(self, scenario: Scenario, budget: int = 20, repeats: int = 10) -> None:
        self.s = scenario
        self.budget = budget
        self.repeats = repeats
        self.history: list[ExperimentRecord] = []

    # ---------------------------------------------------------------- helpers

    @property
    def remaining(self) -> int:
        return self.budget - sum(r.cost for r in self.history)

    def _averaged_vm(self, repeats: int) -> dict[int, float | None]:
        samples: dict[int, list[float]] = {n: [] for n in self.s.metered}
        for _ in range(repeats):
            for n, r in self.s.read_meters().items():
                if r["vm_pu"] is not None:
                    samples[n].append(r["vm_pu"])
        return {n: (float(np.mean(v)) if v else None) for n, v in samples.items()}

    def _state(self) -> tuple[float, float]:
        """Lowest node voltage and highest line loading of the solved network (operating margins)."""
        net = self.s.net
        loading = net.res_line.loading_percent.dropna()
        return float(net.res_bus.vm_pu[self.s.node_ids].min()), float(loading.max()) if len(loading) else 0.0

    def _limits_ok(self) -> tuple[str, dict] | None:
        """The first operating limit the experiment would break: a message and the same reason as data.

        Only margins are reported (worst voltage, worst loading), never which line or where: that
        would hint at the hidden wiring.
        """
        net = self.s.net
        if not net.converged:
            return "the power flow did not converge", {"limit": "not_converged"}
        vm = net.res_bus.vm_pu[self.s.node_ids]
        if vm.isna().any():
            n = int(vm.isna().sum())
            return f"{n} secondary substations would be de-energized", {"limit": "deenergized", "value": n}
        if (vm < V_MIN).any():
            return (f"voltage would leave the {V_MIN}-{V_MAX} pu band (min {vm.min():.3f}, max {vm.max():.3f})",
                    {"limit": "voltage_low", "value": round(float(vm.min()), 4), "threshold": V_MIN})
        if (vm > V_MAX).any():
            return (f"voltage would leave the {V_MIN}-{V_MAX} pu band (min {vm.min():.3f}, max {vm.max():.3f})",
                    {"limit": "voltage_high", "value": round(float(vm.max()), 4), "threshold": V_MAX})
        loading = net.res_line.loading_percent.dropna()
        if len(loading) and loading.max() > MAX_LOADING:
            return (f"a line would be loaded to {loading.max():.0f}% of its rating",
                    {"limit": "line_overload", "value": round(float(loading.max()), 1), "threshold": MAX_LOADING})
        return None

    @staticmethod
    def _safe_kw(before: tuple[float, float], after: tuple[float, float], delta_kw: float) -> float | None:
        """Linear estimate of the largest load step that keeps every limit (voltage and loading), 10 % margin."""
        (v0, l0), (v1, l1) = before, after
        shares = []
        if v1 < v0:
            shares.append((v0 - V_MIN) / (v0 - v1))
        if l1 > l0:
            shares.append((MAX_LOADING - l0) / (l1 - l0))
        if not shares:
            return None
        safe = abs(delta_kw) * min(shares) * 0.9
        return round(safe / 50) * 50 if safe >= 50 else 0.0

    def _record(self, action: dict, ok: bool, msg: str, **kw) -> ExperimentRecord:
        rec = ExperimentRecord(id=len(self.history) + 1, action=action, accepted=ok, message=msg,
                               cost=1 if ok else 0, **kw)
        self.history.append(rec)
        return rec

    def _solve(self) -> bool:
        try:
            pp.runpp(self.s.net)
            return True
        except Exception:  # noqa: BLE001 - pandapower raises several error types
            self.s.net.converged = False
            return False

    # ---------------------------------------------------------------- actions

    def perturb_load(self, node: int, delta_kw: float, repeats: int | None = None) -> ExperimentRecord:
        """Add delta_kw (power factor ~0.95) at a secondary substation and measure every meter."""
        action = {"type": "perturb_load", "node": node, "delta_kw": delta_kw}
        if self.remaining <= 0:
            return self._record(action, False, "experiment budget exhausted")
        if node not in self.s.node_ids:
            return self._record(action, False, f"unknown node {node}")
        if abs(delta_kw) > MAX_DELTA_KW or delta_kw == 0:
            return self._record(action, False, f"delta_kw must be non-zero and within ±{MAX_DELTA_KW:.0f}")
        r = repeats or self.repeats
        self.s.solve(self.s.hour)
        before = self._averaged_vm(r)
        margins = self._state()
        idx = pp.create_load(self.s.net, node, p_mw=delta_kw / 1000, q_mvar=delta_kw * 0.33 / 1000)
        try:
            self._solve()
            problem = self._limits_ok()
            stressed = self._state() if problem and self.s.net.converged else None
            after = None if problem else self._averaged_vm(r)
        finally:
            self.s.net.load.drop(idx, inplace=True)
            self.s.solve(self.s.hour)
        if problem:
            msg, reason = problem
            safe = self._safe_kw(margins, stressed, delta_kw) if stressed and reason["limit"] != "deenergized" else None
            if safe is not None:
                reason["safe_kw"] = safe
            return self._record(action, False, f"rejected: {msg}", rejection=reason)
        deltas = {n: (None if before[n] is None or after[n] is None else round(after[n] - before[n], 6))
                  for n in self.s.metered}
        return self._record(action, True, "ok", delta_vm=deltas, delta_p_kw=delta_kw)

    def toggle_switch(self, switch_id: int, repeats: int | None = None) -> ExperimentRecord:
        """Temporarily operate a switch and measure the voltage changes."""
        action = {"type": "toggle_switch", "switch_id": switch_id}
        if self.remaining <= 0:
            return self._record(action, False, "experiment budget exhausted")
        if switch_id not in self.s.switch_kind:
            return self._record(action, False, f"unknown switch {switch_id}")
        if self.s.switch_kind[switch_id] == "fuse":
            return self._record(action, False, "fuses cannot be operated remotely")
        r = repeats or self.repeats
        self.s.solve(self.s.hour)
        before = self._averaged_vm(r)
        sw = self.s.net.switch
        state = bool(sw.closed.at[switch_id])
        sw.at[switch_id, "closed"] = not state
        try:
            self._solve()
            problem = self._limits_ok()
            after = None if problem else self._averaged_vm(r)
        finally:
            sw.at[switch_id, "closed"] = state
            self.s.solve(self.s.hour)
        if problem:
            return self._record(action, False, f"rejected: {problem[0]}", rejection=problem[1])
        deltas = {n: (None if before[n] is None or after[n] is None else round(after[n] - before[n], 6))
                  for n in self.s.metered}
        verb = "closed" if not state else "opened"
        return self._record(action, True, f"switch temporarily {verb}", delta_vm=deltas)

    def snapshot(self, hour: int) -> dict[int, dict[str, float | None]]:
        """Passive readings at another hour of the day. Free: it is historical data."""
        current = self.s.hour
        self.s.solve(hour)
        readings = self.s.read_meters()
        self.s.solve(current)
        return readings
