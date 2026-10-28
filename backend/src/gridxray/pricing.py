"""Meta Model API pay-as-you-go prices (Standard mode, USD per 1M tokens).

Source: https://dev.meta.ai/docs/pricing-rate-limits (checked 2026-10-27).
"""

PRICES: dict[str, dict[str, float]] = {
    "muse-spark-1.3": {"input": 1.25, "cached_input": 0.15, "output": 4.25},
    "muse-spark-1.3-contributor": {"input": 0.10, "cached_input": 0.002, "output": 0.20},
    "muse-wonder-1.0": {"input": 4.00, "cached_input": 0.20, "output": 20.00},
    # billed per image, not per token
    "muse-image-1.0": {"input": 0.0, "cached_input": 0.0, "output": 0.0, "per_image": 0.01},
    "sam-3.1": {"input": 0.0, "cached_input": 0.0, "output": 0.0, "per_image": 0.0025},
}


def cost_usd(model: str, usage: dict) -> float:
    """Cost of accumulated usage: {input, cached, output} token counts (cached is part of input)."""
    p = PRICES.get(model)
    if not p:
        return 0.0
    fresh = max(0, usage.get("input", 0) - usage.get("cached", 0))
    tokens = (fresh * p["input"] + usage.get("cached", 0) * p["cached_input"] + usage.get("output", 0) * p["output"]) / 1e6
    return tokens + usage.get("images", 0) * p.get("per_image", 0.0)


def add_usage(acc: dict, model: str, resp_usage) -> None:
    """Accumulate a Responses API usage object into acc[model]."""
    if resp_usage is None:
        return
    m = acc.setdefault(model, {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 0})
    m["input"] += getattr(resp_usage, "input_tokens", 0) or 0
    m["output"] += getattr(resp_usage, "output_tokens", 0) or 0
    details = getattr(resp_usage, "input_tokens_details", None)
    m["cached"] += (getattr(details, "cached_tokens", 0) or 0) if details else 0
    out_details = getattr(resp_usage, "output_tokens_details", None)
    m["reasoning"] += (getattr(out_details, "reasoning_tokens", 0) or 0) if out_details else 0
    m["calls"] += 1


def summarize(usage: dict) -> dict:
    per_model = {m: {**u, "cost_usd": round(cost_usd(m, u), 4)} for m, u in usage.items()}
    return {"by_model": per_model,
            "tokens": sum(u["input"] + u["output"] for u in usage.values()),
            "cost_usd": round(sum(v["cost_usd"] for v in per_model.values()), 4)}


def add_images(acc: dict, model: str, n: int = 1) -> None:
    """Count per-image billed calls (Muse Image generations, SAM 3.1 segmentations)."""
    m = acc.setdefault(model, {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 0})
    m["images"] = m.get("images", 0) + n
    m["calls"] += 1
