"""Edge-level comparison between a discovered topology and the ground truth."""

from dataclasses import dataclass

Edge = tuple[int, int]


def _norm(edges: set[Edge]) -> set[Edge]:
    return {(min(a, b), max(a, b)) for a, b in edges}


@dataclass(frozen=True)
class EdgeMetrics:
    precision: float
    recall: float
    f1: float
    true_positives: int
    false_positives: int
    false_negatives: int


def edge_metrics(predicted: set[Edge], truth: set[Edge]) -> EdgeMetrics:
    predicted, truth = _norm(predicted), _norm(truth)
    tp = len(predicted & truth)
    fp = len(predicted - truth)
    fn = len(truth - predicted)
    precision = tp / (tp + fp) if predicted else 0.0
    recall = tp / (tp + fn) if truth else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return EdgeMetrics(precision, recall, f1, tp, fp, fn)
