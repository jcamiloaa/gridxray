"""Client for the Meta Model API.

Uses the Responses API, which Meta recommends for tool-calling agents: it keeps the model's
reasoning across tool turns (via `previous_response_id`) and can return reasoning summaries,
which feed the investigation timeline. Chat Completions drops reasoning between turns.
"""

from openai import OpenAI
from openai.types.responses import Response

from gridxray.config import Settings, settings


class MetaClient:
    def __init__(self, cfg: Settings = settings, timeout: float = 300.0) -> None:
        if not cfg.meta_api_key:
            raise RuntimeError("Set META_API_KEY in backend/.env")
        self._client = OpenAI(
            base_url=cfg.meta_api_base_url, api_key=cfg.meta_api_key, timeout=timeout,
            max_retries=1,
        )

    def respond(
        self,
        model: str,
        input: str | list[dict],
        *,
        instructions: str | None = None,
        tools: list[dict] | None = None,
        previous_response_id: str | None = None,
        reasoning_effort: str = "medium",
    ) -> Response:
        kwargs: dict = {
            "model": model,
            "input": input,
            "reasoning": {"effort": reasoning_effort, "summary": "auto"},
            "store": True,  # previous_response_id chaining needs the server-side copy
        }
        if instructions:
            kwargs["instructions"] = instructions
        if tools:
            kwargs["tools"] = tools
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        return self._client.responses.create(**kwargs)


def reasoning_summary(response: Response) -> str:
    """Join the reasoning summaries of a response; empty if the model produced none."""
    parts = [
        s.text
        for item in response.output
        if item.type == "reasoning"
        for s in (item.summary or [])
    ]
    return " ".join(parts)
