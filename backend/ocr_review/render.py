"""수정 기록을 eDOCr2 색칠 결과 이미지 위에 표시 (선택 기능).

- 고친 기하공차: 파란 박스 + "FIX 0.03 -> 0.003"
- 그대로 확정한 기하공차: 초록 "OK"
- 작업자가 추가한 치수: 빨간 박스 + "ADD 7"
Pillow가 필요하다 (pip install pillow).
"""
from __future__ import annotations

from typing import Optional

from .txt_format import OcrTxt

BLUE, GREEN, RED, WHITE = (29, 78, 216), (21, 128, 61), (185, 28, 28), (255, 255, 255)


def _font(size: int):
    from PIL import ImageFont
    for name in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _label(draw, xy, text, color, font):
    x, y = xy
    box = draw.textbbox((x, y), text, font=font)
    pad = 4
    draw.rectangle((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad), fill=color)
    draw.text((x, y), text, fill=WHITE, font=font)


def render_reviewed(result_jpg: str, reviewed_txt: str, log: dict, out_path: str,
                    frame_offset: Optional[tuple] = None) -> str:
    from PIL import Image, ImageDraw

    doc = OcrTxt.parse(reviewed_txt)
    img = Image.open(result_jpg).convert("RGB")
    draw = ImageDraw.Draw(img)
    font = _font(max(16, img.width // 110))
    off = frame_offset or log.get("frame_offset") or doc.frame_offset or (0, 0)

    by_entry = {}
    for c in log.get("changes", []):
        if c["type"] == "GDT":
            no = int(c["item_id"][1:3])
            by_entry.setdefault(no, []).append(c)
    for entry in doc.gdt:
        cs = by_entry.get(entry.no, [])
        if not cs:
            continue
        edited = [c for c in cs if c["action"] == "edited"]
        x, y = entry.x, entry.y
        if edited:
            texts = []
            for c in edited:
                before = c["before"].split("|")[1] if "|" in c["before"] else c["before"]
                after = c["after"].split("|")[1]
                texts.append(f"FIX {before} -> {after}")
            _label(draw, (x, max(0, y - font.size * len(texts) - 12)), "  ".join(texts), BLUE, font)
        else:
            _label(draw, (x, max(0, y - font.size - 10)), "OK", GREEN, font)

    for c in log.get("changes", []):
        if c["action"] != "added":
            continue
        p = c.get("position_image") or {"x": c["position_frame"]["x"] + off[0],
                                         "y": c["position_frame"]["y"] + off[1]}
        x, y = p["x"], p["y"]
        r = max(24, img.width // 80)
        draw.rectangle((x - r, y - int(r * 1.3), x + r, y + int(r * 1.3)), outline=RED, width=4)
        _label(draw, (x + r + 6, y - font.size // 2), f"ADD {c['after']}", RED, font)

    img.save(out_path, quality=92)
    return out_path
