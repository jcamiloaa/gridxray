"""Client for the Meta Model API.

Uses the Responses API, which Meta recommends for tool-calling agents: it keeps the model's
reasoning across tool turns (via `previous_response_id`) and can return reasoning summaries,
which feed the investigation timeline. Chat Completions drops reasoning between turns.
"""

from openai import OpenAI
from openai.types.responses import Response

from gridxray.config import Settings, settings


class MetaClient:
    def __init__(self, cfg: Settings = settings, timeout: float = 300.0, api_key: str | None = None) -> None:
        key = api_key or cfg.meta_api_key  # a key saved in the app wins over backend/.env
        if not key:
            raise RuntimeError("Set the Meta API key in Usage & settings, or META_API_KEY in backend/.env")
        self._client = OpenAI(base_url=cfg.meta_api_base_url, api_key=key, timeout=timeout, max_retries=1)

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

    # ------------------------------------------------------------ media models

    def generate_image(self, prompt: str, model: str = "muse-image-1.0") -> bytes:
        """Muse Image: one picture from a text prompt, as raw image bytes."""
        import base64

        r = self._client.images.generate(model=model, prompt=prompt, n=1)
        return base64.b64decode(r.data[0].b64_json)

    def segment(self, prompt: str, image_url: str, model: str = "sam-3.1") -> str:
        """SAM 3.1: boxes and masks for every match of a short noun phrase, as SAM's token text."""
        content = [{"type": "input_text", "text": prompt}, {"type": "input_image", "image_url": image_url}]
        r = self._client.responses.create(model=model, input=[{"type": "message", "role": "user", "content": content}],
                                          metadata={"include_confidence": "true"})
        return r.output_text or ""

    def look(self, model: str, question: str, image_url: str, instructions: str, reasoning_effort: str = "low") -> Response:
        """A multimodal question about one image (Muse Spark sees the photo, nothing else)."""
        content = [{"type": "input_text", "text": question}, {"type": "input_image", "image_url": image_url}]
        return self._client.responses.create(model=model, input=[{"type": "message", "role": "user", "content": content}],
                                             instructions=instructions, reasoning={"effort": reasoning_effort}, store=False)


def reasoning_summary(response: Response) -> str:
    """Join the reasoning summaries of a response; empty if the model produced none."""
    parts = [
        s.text
        for item in response.output
        if item.type == "reasoning"
        for s in (item.summary or [])
    ]
    return " ".join(parts)
