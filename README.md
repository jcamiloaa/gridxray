# GridXray — Physical AI for Utilities

GridXray uses Meta's **Muse Spark** to discover hidden connections in simulated electrical distribution networks. The agent reads measurements, formulates hypotheses about which nodes are connected, designs virtual experiments to tell those hypotheses apart, and progressively reconstructs the network. When several topologies remain consistent with the data, or the investigation stalls, **Muse Wonder** steps in as a second-opinion investigator: it reviews the evidence and proposes a different line of inquiry. An independent verifier, with no LLM involved, scores the result against the real network, which is sealed with a SHA-256 commitment before the AI starts and re-checked in the browser afterwards. The investigation combines four sources of evidence: physics experiments, traditional AI (24 h correlation clustering and a Chow-Liu tree), geography, and Meta AI (Muse Wonder infers the topology from the raw data as one vote in an ensemble).

**Initial focus:** medium-voltage distribution networks, using physics-based simulations in pandapower. Everything runs in simulation: no real grids, sensors or SCADA systems.

**Meta Global AI Developer Hackathon 2026** · Track: Startup · Theme: Push the Frontier · by [Zynplex](https://zynplex.com)

## Repository layout

```
gridxray/
├── docker-compose.yml        # postgres + api + web: one command to run everything
├── .env.example              # template for backend/.env (Meta Model API key)
├── backend/                  # Python 3.12 · FastAPI · pandapower  → container "api" (:8000)
│   ├── Dockerfile            # python:3.12-slim + uv, healthcheck on /health
│   ├── pyproject.toml        # dependencies (uv.lock pins exact versions)
│   ├── .env                  # your API key (git-ignored, create from .env.example)
│   ├── src/gridxray/
│   │   ├── lab/              # MV grid generator + CIGRE/Oberrhein benchmarks, load profiles, meter model, hidden truth
│   │   ├── sim/              # experiment engine (constrained virtual interventions)
│   │   ├── tools/            # tools exposed to the agents (observable view only)
│   │   ├── agent/            # Meta Model API client, Spark investigator loop, Wonder reviewer
│   │   ├── verify/           # metrics vs the real network, reference procedures, benchmark
│   │   ├── store/            # Postgres models and session (users; runs and experiments next)
│   │   ├── auth/             # password hashing (argon2), session tokens, demo account
│   │   ├── api/              # REST + SSE, auth routes
│   │   ├── config.py         # settings read from backend/.env
│   │   └── cli.py            # `gridxray generate`, `gridxray ping`
│   └── tests/
└── frontend/                 # React · TypeScript · Vite · three.js (React Three Fiber) → container "web" (:8080)
    ├── Dockerfile            # node:22 build → nginx:1.27 serving static files
    ├── nginx.conf            # serves the app, proxies /api → api:8000 (SSE-ready)
    └── src/
        ├── api/              # typed client for the backend
        ├── pages/            # landing (product story + guide) and workspace
        ├── scene/            # 3D isometric grid: procedural equipment models, fictional city map, street-routed feeders,
        │                     #   energy flow, minimap, controls, fullscreen, 2D fallback
        └── components/       # auth dialog, brand, tooltips, icons
```

```
browser ──► web (nginx :8080) ──/api──► api (FastAPI :8000) ──► Meta Model API (Muse Spark / Wonder)
                                                         ├──► pandapower (in-process simulation)
                                                         └──► postgres (:5432, host :5433)
```

## Quick start (Docker)

```bash
cp .env.example backend/.env      # then paste your Meta Model API key into it
docker compose up --build
```

- Web app: http://localhost:8080 → click **Enter as demo user**
- API docs: http://localhost:8000/docs

### Demo account

A demo account is created on startup, so judges can sign in with one click (**Enter as demo user**) or with email and password:

| Email | Password |
|---|---|
| `demo@gridxray.dev` | `gridxray-demo` |

Change them with `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` in `backend/.env`. Sessions use an HttpOnly cookie signed with `SECRET_KEY`; set your own outside local development.

### Meta Model API key

1. Sign in to the [Meta Model API dashboard](https://dev.meta.ai/) and create an API key ([docs](https://dev.meta.ai/docs/quickstart#api-key)).
2. Copy the template and paste the key after `META_API_KEY=`:

   ```bash
   cp .env.example backend/.env
   ```

   ```
   META_API_KEY=your-key-here
   ```

3. Check access with `docker compose run --rm api gridxray ping`, or `uv run gridxray ping` without Docker.

`backend/.env` is git-ignored: never commit your key. `MODEL_API_KEY`, the name used in Meta's docs, also works.

You can also paste the key in the app, under **Usage & settings**: it is checked with Meta before saving, stored encrypted (with `SECRET_KEY`) and never shown again. A key saved in the app takes priority over `backend/.env`; if neither is set, the app asks for one before running an investigation.

The investigating agents call the Meta Model API, so a key is required to run investigations. Scenario generation and the verifier work without one.

## Development

```bash
cp .env.example backend/.env           # set META_API_KEY
docker compose up -d postgres          # database on localhost:5433
cd backend && uv sync && uv run pytest # tests use in-memory SQLite, no Postgres needed
uv run uvicorn gridxray.api.main:app --reload        # http://localhost:8000
cd ../frontend && npm install && npm run dev         # http://localhost:5173
```

CLI (from `backend/`):

```bash
uv run gridxray ping                                   # check Meta Model API access
uv run gridxray baselines --level medium --seed 3      # score the non-AI reference procedures
uv run gridxray investigate --level easy --seed 1 --budget 8 --log run.json   # real Spark + Wonder run
```

## How an investigation works

1. **Observe**: the agent sees what a utility knows: each secondary substation's city block, meter readings,
   equipment and documented switch states. Never the wiring.
2. **Experiment** (`sim/`): virtual load perturbations and switch operations on the pandapower model, within
   operating limits and an experiment budget. Results are averaged meter deltas, so noise, missing data and
   faulty meters still get through.
3. **Reason** (`agent/`): Muse Spark drives the loop with tool calls (`tools/`): evidence summaries, a candidate
   tree, hypothesis checks against the physics, and the most informative next experiment. Muse Wonder reviews
   when Spark asks, when progress stalls, or before closing with many uncertain edges.
4. **Verify** (`verify/`): an independent scorer compares the result with the true topology and with three
   non-AI procedures: geographic (GIS + one voltage snapshot), passive (24 h voltage correlations) and
   exhaustive (perturb every node).

## Built during the hackathon

All code in this repository was written during the event (Oct 26 – Nov 4, 2026); see the git history. This includes the scenario generator, experiment engine, agent tools and loop, verifier, hybrid methods, seal, API and web UI.

## Third-party

| Component | License | Use |
|---|---|---|
| [pandapower](https://www.pandapower.org/) | BSD-3-Clause | Power-flow simulation; standard cable/transformer types |
| FastAPI, Pydantic, SQLAlchemy, psycopg, PyJWT, argon2-cffi, OpenAI SDK, NumPy, numba | MIT / BSD / Apache-2.0 / LGPL-3.0 | Backend |
| PostgreSQL 18 | PostgreSQL License | Database (container) |
| React, Vite, three.js, React Three Fiber, drei | MIT | Frontend, 3D network view |
| Meta Muse Spark (Meta Model API) | Meta terms | Lead investigator (tool-calling loop) |
| Meta Muse Wonder (Meta Model API) | Meta terms | Second-opinion reviewer |

All grid data is synthetic, generated by this project.
