"""Independent scoring of a proposed topology against the ground truth. No generative model involved."""

from dataclasses import asdict, dataclass

from gridxray.lab import Scenario
from gridxray.verify.metrics import edge_metrics


@dataclass(frozen=True)
class Score:
    precision: float
    recall: float
    f1: float
    correct_edges: int
    total_edges: int
    wrong_edges: int
    uncertain_flagged: int
    wrong_and_flagged: int  # calibration: how many mistakes were honestly flagged as uncertain
    experiments: int

    def to_dict(self) -> dict:
        return asdict(self)


def score(s: Scenario, parent: dict[int, int], uncertain: list[int] | None = None, experiments: int = 0) -> Score:
    truth = s.true_edges
    dead = s.deenergized  # an area in outage has no wiring to find: it is left out of the score
    parent = {c: p for c, p in parent.items() if c not in dead and p not in dead}
    proposed = {(min(c, p), max(c, p)) for c, p in parent.items()}
    m = edge_metrics(proposed, truth)
    wrong_children = {c for c, p in parent.items() if (min(c, p), max(c, p)) not in truth}
    flagged = set(uncertain or [])
    return Score(round(m.precision, 3), round(m.recall, 3), round(m.f1, 3), m.true_positives, len(truth),
                 len(wrong_children), len(flagged), len(wrong_children & flagged), experiments)
