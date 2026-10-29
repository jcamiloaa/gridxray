# GridXray — Physical AI for Utilities

**GridXray uses Meta's Muse models to discover the hidden wiring of electrical distribution networks by experimenting on them.**
An AI investigator reads the meters a utility already has, forms hypotheses about which secondary substation feeds which,
designs virtual experiments on a physics simulator to tell them apart, sends field crews to photograph switches, and
reconstructs the network: with every connection marked as measured, inferred or uncertain, and scored against the truth
by a checker with no AI in it.

**Meta Global AI Developer Hackathon 2026** · Track: Startup · Theme: Push the Frontier · by [Zynplex](https://zynplex.com)

## The problem

Distribution utilities do not know exactly how their medium-voltage networks are connected today. GIS records drift
from reality with every repair and every switching operation; switch positions are documented once and then changed in
the field; and the network is built meshed but operated radially through normally open ties, so the energized topology
is invisible from the map. Wrong topology means wrong fault location, unsafe switching orders, hosting-capacity studies
built on fiction and customers restored late.

Finding out is expensive: crews walking feeders, engineers operating switches one at a time. Every real experiment costs
time, risk and customer impact, so the question is not only *what is the topology* but **which experiment to run next**.
That decision is what GridXray hands to an AI, inside a simulator, before anyone touches the real network.

**Who benefits:** distribution planning and operations engineers (model validation before switching orders and
connection studies), GIS teams (finding outdated records), and field operations (crews sent only where a photo settles
what the meters cannot).

## What it does

1. **Observe.** The agent receives only what a utility knows: each secondary substation's city block, its smart-meter
   reading (noisy, sometimes missing, sometimes faulty), equipment, and the *documented* switch positions. Never the wiring.
2. **Experiment.** It designs load steps and switch operations, run on a real power-flow model (pandapower) within
   operating limits (0.90–1.10 pu, no overloads, no customers left without supply) and a budget. Unsafe experiments are
   refused with the limit they would break and a safe size to retry.
3. **Reason.** Muse Spark leads the investigation through tool calls. Its evidence is combined with traditional methods
   (24 h voltage-correlation clustering and a Chow-Liu tree, a GIS prior) and Muse Wonder's own inference into an
   ensemble that shows where methods agree and where they do not; Spark spends the budget on the disagreements.
4. **Verify in the field.** A crew visit produces a photo of the site (Muse Image), SAM 3.1 segments the equipment, and
   Muse Spark reads the switch position from the photo, flagging records that are outdated.
5. **Conclude.** The result is a radial tree with each connection marked *measured*, *inferred* or *uncertain*, scored by
   an independent checker against the network sealed before the run.

## How Meta models are used

| Model | Role | How |
|---|---|---|
| **Muse Spark 1.3** | Lead investigator | Tool-calling loop over the Responses API (state kept with `previous_response_id`): decides every experiment, interprets results, writes hypotheses, chooses when to send crews and when to stop |
| **Muse Wonder 1.0** | Second opinion and fourth method | Reviews the evidence when the investigation stalls, at mid-budget or before closing with many uncertain connections; separately infers the topology from the raw data as one vote in the ensemble (in a background thread, so Spark keeps experimenting) |
| **Muse Image 1.0** | Field photo | Draws the site the crew would see, from what is physically there in the simulator (including the switch's real position) |
| **SAM 3.1** | Segmentation | Finds the switch, transformer, insulators, cables and tags in the photo (masks decoded with `meta-sam-parser`) |
| **Muse Spark (vision)** | Photo reading | Reads the switch position from the photo and SAM's objects; the investigator receives only this reading, never the simulator's state |

Every call, token and cost is logged in the investigation's record and shown live (*Usage & settings*).

## Why the result can be trusted

- **The topology is sealed before the AI starts.** The server publishes `SHA-256(secret + true topology)` as the first
  event; when the run ends the secret is revealed and your browser recomputes the hash. A match proves the network was
  fixed beforehand. *See what the AI receives* shows the exact input and instructions.
- **The AI never sees the wiring.** Agents get an observable view and experiment results; tests check that the truth
  never leaks.
- **No AI in the score.** An independent checker compares the proposed connections with the simulator's truth
  (correct / real, F1, wrong connections and how many were honestly flagged uncertain).
- **Real physics.** Every experiment is a pandapower power flow, reverted afterwards and charged to the budget.
- **Reproducible.** Same seed, same network. 59 automated tests (results on the *Evidence* page).

## Results

Scored against the real network by the independent checker (real Muse Spark + Muse Wonder runs, same seeds and budgets).

**Benchmark (current version, Muse Spark + Muse Wonder):**

| Level | Runs | Budget | Real connections recovered | F1 | Wrong flagged as uncertain | Cost / run | Time / run |
|---|---|---|---|---|---|---|---|
| Easy (15 substations, every node metered) | 3 | 8 | **40/45 (89%)** | 89% | 1/5 | $0.44 | 5.5 min |
| Medium (30 substations, 2 feeders + tie, 80% metered, missing readings) | 3 | 15 | **57/90 (63%)** | 63% | 16/33 | $0.74 | 7.9 min |

**Ablation: does Muse Wonder add anything?** Same seeds and budgets; "Spark alone" has no Wonder reviews and no
Wonder vote in the ensemble, everything else identical.

| Level | Spark alone | Spark + Wonder | Wrong connections | Cost / run |
|---|---|---|---|---|
| Easy | 37/45 (82%) | **40/45 (89%)** | 8 → 5 | $0.20 → $0.44 |
| Medium | 51/90 (57%) | **57/90 (63%)** | 39 → 33 | $0.17 → $0.74 |

Wonder's second opinion and its own inference raise accuracy on both levels (+7 and +6 points) and cut wrong
connections by a sixth to a third, at 2–4× the cost per run. On medium networks most remaining errors involve
secondary substations without a meter, which only inference can place; GridXray marks them as inferred instead of
claiming them. Field crews read the switch position correctly in 8 of 8 test visits, including 3 outdated records.
Raw results: `backend/results/ablation_*.json`; every run is listed on the *Evidence* page.

## Features

- **Workspace**: build a network (synthetic easy / medium / hard, the CIGRE MV benchmark, or your own), watch the
  investigation live in a 3D city view or a single-line diagram, stop it at any moment, resume after a restart.
- **The AI's network in the diagram**: measured connections in blue, inferred ones dashed; after *Reveal & compare*,
  correct in green, wrong in red and the real connections it missed, with an *AI's network / real network* switch.
- **Field crews**: an animated crew drives to the site; the photo, the SAM 3.1 segmentation and the reading appear in
  the log, with the exact prompt Muse Image received.
- **Design your own network**: place secondary substations on city blocks, join them with overhead lines or underground
  cables, add sectionalizers, reclosers, fuses and normally open ties, and choose each switch's real position and what
  the records say. The editor checks the design live (all supplied, radial, no loops) and can start from any generated
  network.
- **Live intervention**: while the AI investigates, operate switches (close a tie and open a sectionalizer to transfer
  load) or switch meters off. Unsafe operations are refused. The AI is not told: the experiment engine notices the change
  from the baseline readings (a statistical test against meter noise) and from repeated load steps, sets earlier
  experiments aside, and the agent re-tests the area. Each intervention publishes a new commitment; the run is scored
  against the network as it ended while the original seal still verifies.
- **Explained experiments**: every experiment says in plain words what was physically done and, when rejected, which
  limit it would have broken and by how much.
- **Report** per investigation (printable, with crew photos), **Evidence** page (benchmark, ablation, tests,
  guarantees), bilingual interface (English / Spanish).

## Quick start (Docker)

```bash
cp .env.example backend/.env      # then paste your Meta Model API key into it
docker compose up --build
```

- Web app: http://localhost:8080 → click **Enter as demo user**
- API docs: http://localhost:8000/docs

### Demo account

| Email | Password |
|---|---|
| `demo@gridxray.dev` | `gridxray-demo` |

Change them with `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` in `backend/.env`. Sessions use an HttpOnly cookie signed with
`SECRET_KEY`; set your own outside local development. The shared demo account keeps each browser's runs and networks apart.

### Meta Model API key

1. Create a key in the [Meta Model API dashboard](https://dev.meta.ai/) ([docs](https://dev.meta.ai/docs/quickstart#api-key)).
2. Put it in `backend/.env` as `META_API_KEY=...` (`MODEL_API_KEY` also works), or paste it in the app under
   **Usage & settings**: it is checked with Meta, stored encrypted and takes priority over `backend/.env`.
3. Check access: `docker compose run --rm api gridxray ping`.

`backend/.env` is git-ignored. Scenario generation, the editor and the checker work without a key; investigations need one.

## Architecture

```
browser ──► web (nginx :8080) ──/api──► api (FastAPI :8000) ──► Meta Model API (Spark · Wonder · Image · SAM 3.1)
                                                         ├──► pandapower (in-process simulation)
                                                         └──► postgres (:5432, host :5433)
```

Investigations run in background threads and stream Server-Sent Events; every event is stored as it happens, so a run
survives a restart and resumes from its log without repeating experiments.

```
gridxray/
├── docker-compose.yml        # postgres + api + web
├── backend/                  # Python 3.12 · FastAPI · pandapower
│   ├── src/gridxray/
│   │   ├── lab/              # network generator, CIGRE / Oberrhein, designed networks (custom.py), load profiles, meters
│   │   ├── sim/              # experiment engine: limits, budget, field interventions and change detection
│   │   ├── tools/            # what the agents can call (observable view only), reconstruction, ensemble
│   │   ├── agent/            # Meta Model API client, Spark loop, Wonder review and inference, prompts
│   │   ├── field.py          # crew visits: photo prompt, SAM 3.1 parsing, photo reading
│   │   ├── verify/           # independent checker, benchmark and ablation
│   │   ├── seal.py           # topology commitment
│   │   ├── runs.py           # background runs, resume, interventions
│   │   ├── api/              # REST + SSE: investigations, networks, settings, auth
│   │   └── store/            # Postgres models
│   ├── results/              # benchmark, ablation and test results shown on the Evidence page
│   └── tests/
└── frontend/                 # React · TypeScript · Vite · three.js (React Three Fiber)
    └── src/                  # workspace, 3D scene, single-line diagram, editor, live log, evidence
```

## Development

```bash
docker compose up -d postgres                       # database on localhost:5433
cd backend && uv sync && uv run pytest               # tests use SQLite, no Postgres needed
uv run uvicorn gridxray.api.main:app --reload        # http://localhost:8000
cd ../frontend && npm install && npm run dev         # http://localhost:5173
```

CLI (from `backend/`):

```bash
uv run gridxray ping                                                 # check Meta Model API access
uv run gridxray investigate --level easy --seed 1 --budget 8 --log run.json
uv run gridxray benchmark --plan easy:1-3:8,medium:1-3:15 --out results/ablation_wonder.json
uv run gridxray benchmark --plan easy:1-3:8,medium:1-3:15 --out results/ablation_spark.json --no-wonder   # Spark only
uv run gridxray evidence                                              # run the tests for the Evidence page
```

## Honest limits

- Everything runs in simulation: no real grids, sensors or SCADA. Networks are synthetic or published benchmarks.
- Field photos are generated from the simulator's state, so they are as truthful as the simulator; their value here is
  showing the full loop (photo → segmentation → reading → record check), not replacing a real camera.
- Nodes without a meter can only be placed by inference; GridXray marks them as such instead of guessing silently.
- On very small or lightly loaded networks a field change barely moves the voltages; detection then relies on a
  repeated experiment.

## Built during the hackathon

All code in this repository was written during the event (Oct 26 – Nov 4, 2026); see the git history: scenario
generator, experiment engine, agent tools and loop, field crews, network editor, live intervention, checker, seal,
API and web UI.

### Hackathon log

- **Day 1 (Oct 27)** — Project base and Meta Model API access; scenario generator (synthetic, CIGRE MV, MV Oberrhein);
  experiment engine with operating limits; agent tools; Muse Spark investigation loop with Muse Wonder reviews;
  independent checker; hybrid ensemble (physics, 24 h correlations, geography, Wonder's inference); sealed topology
  verified in the browser; live investigations over SSE; 3D city view; Evidence page; faster runs and an immediate STOP;
  explained experiments; Meta API key in the app.
- **Day 2 (Oct 28)** — Field crews: a Muse Image photo of the site, SAM 3.1 segmentation and a Muse Spark reading of the
  switch position in every investigation, with outdated records flagged; animated crew in the 3D view.
- **Day 3 (Oct 29)** — Network editor (design your own network, switches with real and recorded positions); live field
  intervention with change detection by the experiment engine (no false alarms on unchanged networks); interventions
  visible in the scene and in the report; the AI's network in the single-line diagram (measured, inferred, correct,
  wrong, missed); control room with the agents at work and a control center sending each experiment's signals;
  nameplates and hover-only labels; per-image costs in usage; ablation Spark alone vs Spark + Wonder; full README.

## Third-party

| Component | License | Use |
|---|---|---|
| [pandapower](https://www.pandapower.org/) | BSD-3-Clause | Power-flow simulation; standard cable and transformer types; CIGRE MV and MV Oberrhein networks |
| FastAPI, Pydantic, SQLAlchemy, psycopg, sse-starlette, PyJWT, argon2-cffi, cryptography, OpenAI SDK, NumPy, numba, Pillow | MIT / BSD / Apache-2.0 / LGPL-3.0 / HPND | Backend |
| meta-sam-parser | see package | Decoding SAM 3.1 masks |
| PostgreSQL 18 | PostgreSQL License | Database (container) |
| React, Vite, three.js, React Three Fiber, drei | MIT | Frontend, 3D view |
| Meta Muse Spark, Muse Wonder, Muse Image, SAM 3.1 (Meta Model API) | Meta terms | Investigator, reviewer and inference, field photos, segmentation |

All grid data is synthetic, generated by this project or taken from pandapower's published benchmarks.
