from gridxray.runs import usage_totals


def test_totals_include_per_image_charges():
    """Muse Image photos and SAM 3.1 segmentations are billed per image and must reach the session total."""
    rows = [{"usage": {"by_model": {"muse-image-1.0": {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 2, "images": 2},
                                    "sam-3.1": {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 4, "images": 4}}}}]
    t = usage_totals(rows)
    assert t["by_model"]["muse-image-1.0"]["cost_usd"] == 0.02
    assert t["by_model"]["sam-3.1"]["cost_usd"] == 0.01
    assert t["cost_usd"] == 0.03
