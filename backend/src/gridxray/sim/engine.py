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
    # the network changed in the field since the previous experiment (seen in the baseline readings)
    change: dict | None = None
    epoch: int = 0  # experiments of different epochs describe different topologies

    def to_dict(self) -> dict:
        return asdict(self)


class ExperimentEngine:
    def __init__(self, scenario: Scenario, budget: int = 20, repeats: int = 10) -> None:
        self.s = scenario
        self.budget = budget
        self.repeats = repeats
        self.history: list[ExperimentRecord] = []
        self.epoch = 0
        self._baseline: dict[int, float | None] | None = None
        self._responses: dict[int, tuple[dict[int, float], int]] = {}  # node -> last response per MW (this epoch)

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

    def _baseline_change(self, before: dict[int, float | None], repeats: int) -> dict | None:
        """Compare the readings before this experiment with those before the previous one.

        Nothing is operated between experiments, so the baseline only moves when someone changed the
        network in the field (a switch operated, a meter gone offline). The test uses the meters' own
        noise: a clear shift at one meter, or many small shifts together (chi-square over all meters),
        start a new epoch: older experiments describe the old topology.
        """
        prev, self._baseline = self._baseline, before
        if prev is None:
            return None
        sigma = max(1e-6, self.s.sensors.voltage_noise_pu * np.sqrt(2 / repeats))  # std of a baseline difference
        diffs = {n: before[n] - prev[n] for n in before if before.get(n) is not None and prev.get(n) is not None}
        z2 = sum((d / sigma) ** 2 for d in diffs.values())
        k = len(diffs)
        silent = [n for n in before if before.get(n) is None and prev.get(n) is not None]
        clear = any(abs(d) > 5.5 * sigma for d in diffs.values())
        joint = k > 0 and z2 > k + 5.5 * np.sqrt(2 * k)
        if not (clear or joint or silent):
            return None
        return self._new_epoch({n: round(d, 5) for n, d in diffs.items() if abs(d) > 2.5 * sigma}, silent, "baseline")

    def _new_epoch(self, shifts: dict[int, float], silent: list[int], how: str) -> dict:
        self.epoch += 1
        self._responses.clear()
        top = dict(sorted(shifts.items(), key=lambda kv: -abs(kv[1]))[:8])
        return {"epoch": self.epoch, "shifts_pu": top, "offline": silent, "how": how}

    def _response_change(self, node: int, delta_kw: float, deltas: dict[int, float | None], repeats: int) -> dict | None:
        """A repeated load step at the same node should give the same voltage response; if not, the wiring changed."""
        per_mw = {n: d * 1000 / delta_kw for n, d in deltas.items() if d is not None}
        prev = self._responses.get(node)
        self._responses[node] = (per_mw, repeats)
        if prev is None:
            return None
        old, r0 = prev
        sigma = self.s.sensors.voltage_noise_pu * np.sqrt(2 / repeats + 2 / r0) * 1000 / abs(delta_kw)
        diffs = {n: per_mw[n] - old[n] for n in per_mw if n in old}
        if not diffs or not any(abs(d) > 6 * max(sigma, 1e-7) for d in diffs.values()):
            return None
        scale = abs(delta_kw) / 1000
        change = self._new_epoch({n: round(d * scale, 5) for n, d in diffs.items() if abs(d) > 3 * sigma}, [], "repeated experiment")
        self._responses[node] = (per_mw, repeats)  # the first response of the new epoch
        return change

    def _record(self, action: dict, ok: bool, msg: str, **kw) -> ExperimentRecord:
        kw.setdefault("epoch", self.epoch)
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
        with self.s.lock:
            return self._perturb_load(node, delta_kw, repeats)

    def _perturb_load(self, node: int, delta_kw: float, repeats: int | None) -> ExperimentRecord:
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
        change = self._baseline_change(before, r)
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
            return self._record(action, False, f"rejected: {msg}", rejection=reason, change=change)
        deltas = {n: (None if before[n] is None or after[n] is None else round(after[n] - before[n], 6))
                  for n in self.s.metered}
        change = change or self._response_change(node, delta_kw, deltas, r)
        return self._record(action, True, "ok", delta_vm=deltas, delta_p_kw=delta_kw, change=change)

    def toggle_switch(self, switch_id: int, repeats: int | None = None) -> ExperimentRecord:
        """Temporarily operate a switch and measure the voltage changes."""
        with self.s.lock:
            return self._toggle_switch(switch_id, repeats)

    def _toggle_switch(self, switch_id: int, repeats: int | None) -> ExperimentRecord:
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
        change = self._baseline_change(before, r)
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
            return self._record(action, False, f"rejected: {problem[0]}", rejection=problem[1], change=change)
        deltas = {n: (None if before[n] is None or after[n] is None else round(after[n] - before[n], 6))
                  for n in self.s.metered}
        verb = "closed" if not state else "opened"
        return self._record(action, True, f"switch temporarily {verb}", delta_vm=deltas, change=change)

    def snapshot(self, hour: int) -> dict[int, dict[str, float | None]]:
        """Passive readings at another hour of the day. Free: it is historical data."""
        with self.s.lock:
            current = self.s.hour
            self.s.solve(hour)
            readings = self.s.read_meters()
            self.s.solve(current)
            return readings


def apply_intervention(s: Scenario, toggles: list[int], meters_off: list[int]) -> str | None:
    """Change the real network in the field (what the agents must notice by themselves).

    Switches are operated for good; meters go offline. Refused, and fully undone, when the result
    would not be a safe radial network: a loop, customers left without supply or a broken limit.
    Returns the reason for a refusal, None when applied.
    """
    import dataclasses

    with s.lock:
        sw = s.net.switch
        for i in toggles:
            if i not in s.switch_kind:
                return f"unknown switch {i}"
            if s.switch_kind[i] == "fuse":
                return "fuses are not operated: replace the cutout instead"
        for n in meters_off:
            if n not in s.metered:
                return f"{s.names.get(n, n)} has no meter"
        before = {i: bool(sw.closed.at[i]) for i in toggles}
        for i in toggles:
            sw.at[i, "closed"] = not before[i]
        problem = None
        try:
            s.solve(s.hour)
        except Exception:  # noqa: BLE001 - pandapower raises several error types
            problem = "the power flow does not converge"
        if problem is None:
            vm = s.net.res_bus.vm_pu[s.node_ids]
            if vm.isna().any():
                dead = [s.names[int(b)] for b in vm.index[vm.isna()]]
                problem = f"{', '.join(dead[:5])}{'…' if len(dead) > 5 else ''} would be left without supply"
            elif len(s.true_edges) > len(s.node_ids):
                problem = "it would close a loop: open another switch in the same operation to keep the network radial"
            elif (vm < V_MIN).any() or (vm > V_MAX).any():
                problem = f"voltage would leave the {V_MIN}-{V_MAX} pu band (min {vm.min():.3f})"
            else:
                loading = s.net.res_line.loading_percent.dropna()
                if len(loading) and loading.max() > MAX_LOADING:
                    problem = f"a line would be loaded to {loading.max():.0f}% of its rating"
        if problem:
            for i, closed in before.items():
                sw.at[i, "closed"] = closed
            s.solve(s.hour)
            return problem
        if meters_off:
            s.sensors = dataclasses.replace(s.sensors, faulty_meters={**s.sensors.faulty_meters,
                                                                      **{n: "dead" for n in meters_off}})
        return None
