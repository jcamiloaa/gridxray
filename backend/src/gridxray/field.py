"""Field crews: a site visit returns a photo, SAM 3.1 segments the equipment and Muse Spark reads it.

The photo is drawn by Muse Image from what is physically at the site in the simulator (mount type,
transformer, the switch installed there and its REAL position). That is the only place the hidden
state enters, exactly as a real crew would see it. The investigator never receives these facts: it
gets Muse Spark's reading of the picture, which can be wrong if the picture is ambiguous.
"""

import base64
import io
import json
import re
from dataclasses import dataclass

from PIL import Image

from gridxray.lab import Scenario

PHOTO_WIDTH = 1280  # stored and segmented at this width, so SAM's boxes match the stored picture
# noun phrases SAM 3.1 recognises on these pictures (found by trying) -> what we call them
SAM_PROMPTS = {
    "pole": {"electrical box": "switch", "gray cylinder": "transformer", "insulator": "insulator", "metal plate": "tag"},
    "kiosk": {"electrical box": "kiosk", "door": "kiosk door", "cable": "cable", "metal plate": "tag"},  # here the box is the kiosk
}

READER_INSTRUCTIONS = """\
You are a distribution-network field inspector reviewing a crew's photo of a medium-voltage site.
Report only what the photo shows. Return ONLY JSON:
{"switch_present": true|false, "switch_state": "open"|"closed"|"unknown",
 "switch_tag": "<tag text or null>", "site_tag": "<tag text or null>",
 "mount": "pole"|"kiosk"|"unknown", "line": "overhead"|"underground"|"unknown",
 "meter_fault": true|false, "equipment": ["..."], "confidence": 0..1, "notes": "<one sentence>"}
Switchgear convention: the mechanical position indicator shows "I" on red when CLOSED and "O" on green when OPEN;
an open blade also shows a visible air gap. If the indicator is not readable, say "unknown" and lower the confidence.
meter_fault is true only if the photo clearly shows a damaged smart-meter box (scorched, smoking or with a dead display)."""


@dataclass
class SiteFacts:
    node: int
    name: str
    mount: str  # pole | kiosk
    line: str  # overhead | underground
    switch_id: int | None
    switch_kind: str | None
    switch_closed: bool | None  # the REAL position (records may say otherwise)
    meter_offline: bool = False  # its meter failed in the field (a live intervention)

    def public(self) -> dict:
        return {"site": self.name, "mount": self.mount, "line": self.line, "meter": "damaged" if self.meter_offline else "ok",
                "switch": None if self.switch_id is None else {"tag": f"SW-{self.switch_id}", "kind": self.switch_kind,
                                                               "real_position": "closed" if self.switch_closed else "open"}}


def site_facts(s: Scenario, node: int, switch_id: int | None = None) -> SiteFacts:
    """What a crew would physically find at a node (simulator truth: never given to the investigator).

    Where several switches share the site, the crew inspects `switch_id` (else the first one).
    """
    sw = s.net.switch
    here = [int(i) for i in s.switch_kind if int(sw.bus.at[i]) == node and s.switch_kind[int(i)] != "fuse"]
    if switch_id in here:
        here = [switch_id]
    lines = s.net.line[(s.net.line.from_bus == node) | (s.net.line.to_bus == node)]
    underground = len(lines) and (lines.get("type", "ol") == "cs").all()
    sid = here[0] if here else None
    return SiteFacts(node, s.names[node], s.mount.get(node, "kiosk"), "underground" if underground else "overhead",
                     sid, s.switch_kind.get(sid) if sid is not None else None,
                     bool(sw.closed.at[sid]) if sid is not None else None,
                     s.sensors.faulty_meters.get(node) == "dead")


def switch_sites(s: Scenario) -> dict[int, int]:
    """Switch id -> the node where it is installed (the utility's GIS knows device locations)."""
    sw = s.net.switch
    return {int(i): int(sw.bus.at[i]) for i in s.switch_kind
            if s.switch_kind[int(i)] != "fuse" and int(sw.bus.at[i]) in s.names and int(sw.bus.at[i]) not in s.roots}


def photo_prompt(f: SiteFacts) -> str:
    if f.mount == "pole":
        site = ("a weathered wooden medium-voltage distribution pole on a quiet city street, with a gray pole-mounted "
                "distribution transformer (cylindrical tank) and porcelain insulators on a crossarm carrying three "
                "overhead conductors")
    else:
        site = ("a green ground-mounted medium-voltage kiosk substation (compact secondary substation) on a city "
                "sidewalk, front doors open showing the transformer and the switchgear panel, with underground cables")
    switch = ""
    if f.switch_id is not None:
        state = ("OPEN: its mechanical position indicator shows a large white \"O\" on a GREEN background, and the blade "
                 "is swung away from the contact with a visible air gap" if not f.switch_closed else
                 "CLOSED: its mechanical position indicator shows a large white \"I\" on a RED background, and the "
                 "blade is fully seated in the contact with no gap")
        switch = (f" In the foreground, large and in sharp focus, a gray medium-voltage load-break switch {state}. "
                  f"A metal tag on the switch reads \"SW-{f.switch_id}\".")
    fault = (" Mounted on the structure, the smart-meter box is clearly damaged: its casing scorched and blackened, "
             "a thin wisp of gray smoke rising from it, its display dark." if f.meter_offline else "")
    return (f"Realistic documentary photo taken by a utility field crew in daylight: {site}.{switch}{fault} "
            f"A small metal plate on the structure reads \"{f.name}\". Sharp focus on the equipment. "
            "No company logos, no brand names, no people's faces, no other text.")


def to_jpeg(raw: bytes) -> tuple[bytes, int, int]:
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.width > PHOTO_WIDTH:
        im = im.resize((PHOTO_WIDTH, round(im.height * PHOTO_WIDTH / im.width)))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=86)
    return buf.getvalue(), im.width, im.height


def data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


_RECORD = re.compile(r"(\d+)<\|box;([^|]*)\|><\|mask;([^|]*)\|>")


def parse_sam(text: str, label: str) -> list[dict]:
    """SAM 3.1 token text -> objects with a box (image pixels), a score and the mask as an SVG path.

    The mask raster covers the box; its path is in raster units, scaled onto the box when drawn.
    """
    from meta_sam_parser import SegmentationMask, decode_mask_to_svg_path

    out = []
    for oid, box, mask in _RECORD.findall(text):
        b = dict(kv.split("=", 1) for kv in box.split(";"))
        m = dict(kv.split("=", 1) for kv in mask.split(";"))
        h, w, payload = m["data"].split(",", 2)
        try:
            path = decode_mask_to_svg_path(SegmentationMask("one_bit" if payload[0] == "!" else "lossless", payload, int(w), int(h)))
        except Exception:  # noqa: BLE001 - a box is still useful without its mask
            path = ""
        out.append({"label": label, "id": int(oid), "box": [int(b["x1"]), int(b["y1"]), int(b["x2"]), int(b["y2"])],
                    "score": round(float(b.get("c", 0) or 0), 3), "mask": {"w": int(w), "h": int(h), "path": path}})
    return out


def parse_reading(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    try:
        return json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        return {}
