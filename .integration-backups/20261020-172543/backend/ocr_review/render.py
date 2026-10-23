"""검수 결과 이미지 2개 (선택 기능, Pillow 필요: pip install pillow)

1) 도면_reviewed.jpg   = 검수 끝난 도면
   eDOCr2 색칠 결과(도면_result.jpg) 그대로 + OCR이 못 읽어서 작업자가 추가한 치수만
   eDOCr2와 같은 치수 색으로 형광펜 칠함. 글씨(라벨)는 안 붙임.
   → 고친 값(FIX)은 OCR이 잘못 읽은 것이지 도면이 틀린 게 아니라서 표시하지 않음.

2) 도면_edits_log.jpg  = 수정 기록용 (로그)
   - 고친 기하공차: 파란 "FIX OCR값 -> 고친값"
   - 그대로 확정한 기하공차: 초록 "OK"
   - 작업자가 추가한 치수: 빨간 박스 + "ADD 7"
   - 잘못 읽어서 고친 치수: 파란 "FIX 5 -> 84"
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


def render_edits_log(result_jpg: str, reviewed_txt: str, log: dict, out_path: str,
                     frame_offset: Optional[tuple] = None) -> str:
    """도면_edits_log.jpg : 무엇을 확인/수정/추가했는지 라벨로 표시 (기록용)"""
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

    for c in log.get("changes", []):          # 고친 치수: 파란 "FIX 5 -> 84"
        if c["type"] != "DIMENSION" or c["action"] != "edited":
            continue
        x, y = c["position_frame"]["x"] + off[0], c["position_frame"]["y"] + off[1]
        _label(draw, (x + 30, max(0, y - font.size - 30)), f"FIX {c['before']} -> {c['after']}", BLUE, font)

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


# ---------------------------------------------------------------- 도면_reviewed.jpg
DIM_COLOR = (187, 185, 110)   # eDOCr2 치수 색 (output_tools.mask_img 의 BGR (110,185,187) → RGB)


def _added_position(c: dict, off) -> tuple:
    p = c.get("position_image") or {"x": c["position_frame"]["x"] + off[0],
                                     "y": c["position_frame"]["y"] + off[1]}
    return int(p["x"]), int(p["y"])


def fit_text_box(gray, x: int, y: int, text: str) -> tuple:
    """클릭한 점(x, y) 주변 글자 영역을 찾는다 → (x1, y1, x2, y2)

    글자 크기를 이미지 폭으로 어림잡고, 그 범위 안의 검은 픽셀 중
    치수선·연장선처럼 길게 이어진 선은 빼고 글자만 감싼다. 못 찾으면 어림 박스.
    """
    W, H = gray.size
    ch = max(12, W // 55)                                   # 글자 높이 어림 (2339px → 42px)
    cw = int(ch * 0.62)
    n = max(1, len(text))
    hw, hh = int(cw * n * 0.8) + ch // 2, int(ch * 0.8)      # 찾을 범위 (반폭, 반높이)
    x1, y1, x2, y2 = max(0, x - hw), max(0, y - hh), min(W, x + hw), min(H, y + hh)
    guess = (max(0, x - cw * n // 2 - 4), max(0, y - ch // 2 - 4),
             min(W, x + cw * n // 2 + 4), min(H, y + ch // 2 + 4))
    if x2 - x1 < 3 or y2 - y1 < 3:
        return guess
    crop = gray.crop((x1, y1, x2, y2))
    w, h = crop.size
    px = crop.load()
    dark = [[px[i, j] < 128 for i in range(w)] for j in range(h)]
    for j in range(h):                                       # 가로로 긴 선 지우기
        if sum(dark[j]) > 0.6 * w:
            dark[j] = [False] * w
    for i in range(w):                                       # 세로로 긴 선 지우기
        if sum(dark[j][i] for j in range(h)) > 0.9 * h:
            for j in range(h):
                dark[j][i] = False
    cols = [i for i in range(w) if any(dark[j][i] for j in range(h))]
    rows = [j for j in range(h) if any(dark[j])]
    if not cols or not rows:
        return guess
    pad = 4
    return (max(0, x1 + cols[0] - pad), max(0, y1 + rows[0] - pad),
            min(W, x1 + cols[-1] + 1 + pad), min(H, y1 + rows[-1] + 1 + pad))


def highlight(img, box: tuple, color: tuple = DIM_COLOR):
    """eDOCr2 mask_box 와 같은 방식 (픽셀 AND 색) 으로 칠함 → 같은 형광펜 색"""
    from PIL import Image
    region = img.crop(box)
    bands = [b.point(lambda v, c=c: v & c) for b, c in zip(region.split(), color)]
    img.paste(Image.merge("RGB", bands), box[:2])
    return img


def render_reviewed(result_jpg: str, reviewed_txt: str, log: dict, out_path: str,
                    frame_offset: Optional[tuple] = None) -> str:
    """도면_reviewed.jpg : 색칠 결과 + 작업자가 추가한 치수만 형광펜 (라벨 없음)"""
    from PIL import Image

    doc = OcrTxt.parse(reviewed_txt)
    img = Image.open(result_jpg).convert("RGB")
    gray = img.convert("L")
    off = frame_offset or log.get("frame_offset") or doc.frame_offset or (0, 0)
    for c in log.get("changes", []):
        if c["action"] != "added":
            continue
        box = c.get("box_image")
        if not box:
            x, y = _added_position(c, off)
            box = fit_text_box(gray, x, y, (c.get("input") or {}).get("value") or c["after"])
        highlight(img, tuple(box))
    img.save(out_path, quality=92)
    return out_path
