"""Commitment to the hidden topology, published before the investigation starts.

commitment = SHA-256(nonce + canonical topology). The nonce stays on the server until the
run has finished; then anyone can recompute the hash from the revealed network and check it
matches, which proves the network was fixed before the AI started and never shown to it.
"""

import hashlib
import json
import secrets

from gridxray.lab import Scenario

ALGORITHM = "SHA-256(nonce + canonical topology JSON)"


def canonical(s: Scenario) -> str:
    """Stable text form of the true topology: energized connections and every switch's real state."""
    sw = s.net.switch
    return json.dumps({
        "edges": sorted([min(a, b), max(a, b)] for a, b in s.true_edges),
        "switches": sorted([int(i), bool(sw.closed.at[i])] for i in s.switch_kind),
    }, separators=(",", ":"))


def new_nonce() -> str:
    return secrets.token_hex(16)


def commitment(nonce: str, text: str) -> str:
    return hashlib.sha256((nonce + text).encode()).hexdigest()
