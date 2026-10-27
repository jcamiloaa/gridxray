"""Synthetic 24-hour load profiles (multipliers of each node's peak demand)."""

import numpy as np

HOURS = 24
_h = np.arange(HOURS)


def _bump(center: float, width: float) -> np.ndarray:
    return np.exp(-0.5 * ((_h - center) / width) ** 2)


def residential() -> np.ndarray:
    curve = 0.35 + 0.25 * _bump(8, 1.5) + 0.65 * _bump(19.5, 2.2)
    return curve / curve.max()


def commercial() -> np.ndarray:
    curve = 0.25 + 0.75 * (_bump(11, 2.5) + _bump(15.5, 2.5)) / 1.6
    return curve / curve.max()


def solar() -> np.ndarray:
    """PV output as a fraction of rated power: zero at night, peak at solar noon."""
    return np.clip(np.cos((_h - 12.5) / 6.5 * np.pi / 2), 0, None) ** 1.5


PROFILES = {"residential": residential, "commercial": commercial}


def sample_profile(kind: str, rng: np.random.Generator, noise: float = 0.04) -> np.ndarray:
    """Base curve for `kind` with per-node noise, clipped to (0, 1]."""
    curve = PROFILES[kind]() * (1 + rng.normal(0, noise, HOURS))
    return np.clip(curve, 0.05, 1.0)
