from gridxray.verify.metrics import edge_metrics


def test_edge_metrics_is_orientation_agnostic():
    m = edge_metrics({(2, 1), (3, 4)}, {(1, 2), (2, 5)})
    assert (m.true_positives, m.false_positives, m.false_negatives) == (1, 1, 1)
    assert m.f1 == 0.5
