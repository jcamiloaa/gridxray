"""Connectivity check for the Meta Model API: Spark tool-call round trip + Wonder reasoning."""

import json
import time

from gridxray.agent.client import MetaClient, reasoning_summary
from gridxray.config import settings

_VOLTAGE_TOOL = {
    "type": "function",
    "name": "get_voltage",
    "description": "Return the measured voltage magnitude (pu) at a grid node.",
    "parameters": {
        "type": "object",
        "properties": {"node": {"type": "integer", "description": "Node id"}},
        "required": ["node"],
        "additionalProperties": False,
    },
}
_FAKE_VOLTAGES = {3: 0.987, 7: 0.962}


def ping() -> None:
    client = MetaClient()

    t0 = time.perf_counter()
    r = client.respond(
        settings.spark_model,
        "Which node has the lower voltage, 3 or 7? Use the tool for both, then answer briefly.",
        tools=[_VOLTAGE_TOOL],
        reasoning_effort=settings.spark_reasoning_effort,
    )
    calls = [item for item in r.output if item.type == "function_call"]
    print(f"[spark] {settings.spark_model}: {len(calls)} tool call(s) "
          f"{[(c.name, c.arguments) for c in calls]}")
    if not calls:
        raise SystemExit(f"[spark] expected a tool call, got: {r.output_text!r}")
    outputs = [
        {"type": "function_call_output", "call_id": c.call_id,
         "output": json.dumps({"vm_pu": _FAKE_VOLTAGES.get(json.loads(c.arguments)["node"])})}
        for c in calls
    ]
    r = client.respond(
        settings.spark_model, outputs, tools=[_VOLTAGE_TOOL], previous_response_id=r.id,
        reasoning_effort=settings.spark_reasoning_effort,
    )
    # A model may fetch one node per turn; finish any remaining calls.
    while extra := [item for item in r.output if item.type == "function_call"]:
        outputs = [
            {"type": "function_call_output", "call_id": c.call_id,
             "output": json.dumps({"vm_pu": _FAKE_VOLTAGES.get(json.loads(c.arguments)["node"])})}
            for c in extra
        ]
        r = client.respond(
            settings.spark_model, outputs, tools=[_VOLTAGE_TOOL], previous_response_id=r.id,
            reasoning_effort=settings.spark_reasoning_effort,
        )
    print(f"[spark] answer: {r.output_text.strip()}  ({time.perf_counter() - t0:.1f}s, "
          f"{r.usage.total_tokens if r.usage else '?'} tokens)")

    t0 = time.perf_counter()
    r = client.respond(
        settings.wonder_model,
        "In a radially operated distribution feeder, increasing the load at node A lowers the "
        "voltage at node B by 0.004 pu and at node C by 0.001 pu. In one sentence: what does "
        "that suggest about where B and C sit relative to A's path to the substation?",
        reasoning_effort=settings.wonder_reasoning_effort,
    )
    print(f"[wonder] {settings.wonder_model}: {r.output_text.strip()}")
    summary = reasoning_summary(r)
    print(f"[wonder] reasoning summary: {summary or '(none returned)'}  "
          f"({time.perf_counter() - t0:.1f}s, {r.usage.total_tokens if r.usage else '?'} tokens)")
