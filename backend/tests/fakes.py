"""Test doubles."""

import json
from types import SimpleNamespace

from gridxray.config import settings
from gridxray.tools import ToolBox


def _call(name, args, i):
    return SimpleNamespace(type="function_call", name=name, arguments=json.dumps(args), call_id=f"c{i}")


class ScriptedClient:
    """Plays the role of Muse Spark / Wonder with fixed moves, in the Responses API shape."""

    def __init__(self, scenario):
        self.s = scenario
        self.turn = 0
        self.wonder_calls = 0

    def respond(self, model, input, **kw):
        if model == settings.wonder_model:
            self.wonder_calls += 1
            return SimpleNamespace(id="w", output=[], output_text="Perturb the deepest node.", usage=None)
        self.turn += 1
        tb_names = {n.id: n.name for n in self.s.observable().nodes}
        deep = tb_names[self.s.node_ids[-1]]
        moves = {
            1: [_call("get_overview", {}, 1)],
            2: [_call("run_experiment", {"kind": "perturb_load", "node": deep, "delta_kw": 2000}, 2),
                _call("note_hypothesis", {"statement": "deep chain", "confidence": 0.6}, 3)],
            3: [_call("request_review", {"reason": "two branches fit"}, 4)],
        }
        if self.turn in moves:
            return SimpleNamespace(id=f"r{self.turn}", output=moves[self.turn], output_text="", usage=None)
        tb = ToolBox(self.s)
        edges = [{"child": e["child"], "parent": e["parent"]} for e in tb.call("infer_tree", {})["edges"]]
        return SimpleNamespace(id="end", output=[_call("submit_result", {"edges": edges, "uncertain": [], "summary": "done"}, 9)],
                               output_text="", usage=None)


