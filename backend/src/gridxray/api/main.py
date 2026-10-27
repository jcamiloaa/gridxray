"""HTTP API. Investigation streaming over SSE lands on D6."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gridxray import __version__
from gridxray.lab import Complexity, generate_scenario

app = FastAPI(title="GridXray", version=__version__)
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.post("/scenarios")
def create_scenario(complexity: Complexity = Complexity.EASY, seed: int = 0) -> dict:
    """Generate a scenario and return only its observable view."""
    obs = generate_scenario(complexity, seed).observable()
    return {"seed": seed, "complexity": complexity, **obs.__dict__}
