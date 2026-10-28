"""Fourth method: the Meta model infers the topology directly from the raw experiment data.

Muse Wonder receives the same observable information as every other method (blocks, meter
readings, and the measured voltage drops of each experiment) and returns, for every node, the
parent it believes feeds it and whether it is sure. Its answer is one vote in the ensemble.
"""

import json
import re

from gridxray.agent.client import MetaClient, reasoning_summary
from gridxray.lab import ObservableGrid
from gridxray.tools.reconstruct import Candidate, Evidence, best_tree, check_tree

INSTRUCTIONS = """\
You reconstruct the hidden topology of a radially operated 20 kV distribution network from data.
Physics: adding load at node i lowers the voltage at node j by (impedance of the path i and j share
from the substation) x load. So, per MW, the drop at i itself is i's electrical depth; every node
downstream of i drops by that same amount; nodes on other branches drop less (by the depth of the
branching point). Line sections only join city blocks at most 2 streets apart (Manhattan distance on
(column, row)); the substation sits at column -1. Voltages fall with electrical distance.

Return ONLY a JSON object, no prose:
{"parents": {"<node>": "<parent node or substation name>", ...every node...},
 "uncertain": ["<node>", ...], "rationale": "<two sentences>"}
"""


def _dossier(obs: ObservableGrid, ev: Evidence) -> str:
    name = {n.id: n.name for n in obs.nodes} | {s.id: s.name for s in obs.substations}
    nodes = [{"node": n.name, "block": n.location, "metered": n.metered,
              "vm_pu": obs.readings.get(n.id, {}).get("vm_pu")} for n in obs.nodes]
    drops = {name[i]: {name[j]: round(v * 1000, 3) for j, v in sorted(row.items(), key=lambda x: -x[1])}
             for i, row in ev.sens.items()}
    return json.dumps({"substations": [{"name": s.name, "block": s.location} for s in obs.substations],
                       "nodes": nodes, "experiments_drop_mpu_per_mw": drops}, separators=(",", ":"))


def meta_infer(client: MetaClient, model: str, effort: str, obs: ObservableGrid, ev: Evidence,
               language: str = "en") -> tuple[Candidate, dict]:
    """Ask the Meta model for a full tree; repair anything invalid with the physics fit."""
    rules = INSTRUCTIONS + ("\nWrite the rationale in Spanish." if language == "es" else "")
    resp = client.respond(model, _dossier(obs, ev), instructions=rules, reasoning_effort=effort)
    text = resp.output_text or ""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    data = json.loads(match.group(0)) if match else {}
    ids = {n.name: n.id for n in obs.nodes} | {s.name: s.id for s in obs.substations}
    physics = best_tree(obs, ev)
    parent = dict(physics.parent)
    taken = 0
    for child, par in (data.get("parents") or {}).items():
        if child in ids and par in ids and ids[child] != ids[par]:
            parent[ids[child]] = ids[par]
            taken += 1
    if check_tree(obs, parent):  # a loop or dangling parent: fall back to physics for safety
        parent, taken = dict(physics.parent), 0
    uncertain = [ids[u] for u in data.get("uncertain", []) if u in ids]
    info = {"nodes_answered": taken, "uncertain": len(uncertain), "rationale": data.get("rationale", ""),
            "reasoning": reasoning_summary(resp), "usage": resp.usage}
    return Candidate(parent, {n: ("uncertain" if n in uncertain else "inferred") for n in parent}), info
