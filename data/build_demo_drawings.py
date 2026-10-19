"""목업(데모) 화면용 도면 데이터 만들기.

data/normalized/*_metadata.json (검수 확정된 추출 결과) + 도면 이미지
  → frontend/public/drawings/<도면ID>.json + 이미지 + index.json
data/error_cases/*.xlsx (오류사례 DB)
  → frontend/public/drawings/error_cases.json

하는 일
  1. 도면별 메타데이터와 이미지를 프론트 public 폴더로 복사
  2. 도면 이미지의 하이라이트(치수: 연노랑, 기하공차: 갈색)에서 글자/틀 박스를 찾아
     번호 마커를 붙일 위치(label_anchor: x, y, side)를 계산
     → 마커가 치수 글자를 가리지 않게 박스 바깥에 붙인다
  3. 검수 전 OCR 값이 남아 있는 샘플 도면(1번)은 도면과 대조한 확정값으로 바로잡는다

실행 (프로젝트 최상위 폴더에서):
    python data/build_demo_drawings.py
필요 패키지: pillow, numpy, scipy, openpyxl
새 도면을 추가하면 normalized JSON과 검수 이미지를 넣고 다시 실행하면 된다.
"""
from __future__ import annotations

import glob
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "frontend" / "public" / "drawings"

# 도면과 대조해 확정한 값 (1번 샘플 도면은 검수 전 OCR 결과라 깨진 값이 있음)
CORRECTIONS = {
    "1": {
        "DIMENSION_001": dict(raw_text="⌀12 -0.006/-0.017", feature_type="SHAFT", nominal_value=12.0,
                              tol_type="DEVIATION", upper_deviation=-0.006, lower_deviation=-0.017,
                              lower_limit=11.983, upper_limit=11.994),
        "DIMENSION_016": dict(raw_text="⌀12 -0.006/-0.017", feature_type="SHAFT", nominal_value=12.0,
                              tol_type="DEVIATION", upper_deviation=-0.006, lower_deviation=-0.017,
                              lower_limit=11.983, upper_limit=11.994),
        "GDT_001": dict(raw_text="○|0.005", gdt_symbol="○", gdt_type="CIRCULARITY", gdt_name_ko="진원도",
                        tolerance_value=0.005, datum_references=[], row_index=1, frame_id="GDT_001"),
        "GDT_002": dict(raw_text="↗|0.015|A-B", gdt_symbol="↗", gdt_type="CIRCULAR_RUNOUT",
                        gdt_name_ko="원주 흔들림", tolerance_value=0.015, datum_references=["A-B"],
                        row_index=1, frame_id="GDT_002"),
    }
}
CORRECTION_NOTE = "검수 확정값: OCR 원문이 깨져 도면과 대조해 수정"


def image_for(doc_id: str, meta: dict) -> Path | None:
    candidates = [DATA / "reviewed" / f"{doc_id}_reviewed.jpg", DATA / meta["image"].get("file", "")]
    if doc_id == "1":
        candidates.insert(0, DATA / "1_image.png")
    return next((p for p in candidates if p.is_file()), None)


# ------------------------------------------------------------ 하이라이트 박스 찾기
def highlight_masks(rgb: np.ndarray):
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    dim = (r > 150) & (g > 150) & (b < 150) & (abs(r - g) < 25)               # 치수: 연노랑
    gdt = (r > 140) & (g > 100) & (g < 165) & (b < 115) & (r - g > 25)          # 기하공차: 갈색
    # 글자 획 때문에 끊긴 조각을 이어 붙인다
    dim = ndimage.binary_closing(dim, structure=np.ones((7, 7)))
    gdt = ndimage.binary_closing(gdt, structure=np.ones((7, 7)))
    return dim, gdt


def box_near(labels: np.ndarray, x: int, y: int, search: int):
    h, w = labels.shape
    x0, x1 = max(0, x - search), min(w, x + search + 1)
    y0, y1 = max(0, y - search), min(h, y + search + 1)
    window = labels[y0:y1, x0:x1]
    ids = window[window > 0]
    if ids.size == 0:
        return None
    # 기준점에 가장 가까운 덩어리
    ys, xs = np.nonzero(window)
    d = (xs + x0 - x) ** 2 + (ys + y0 - y) ** 2
    label = window[ys[d.argmin()], xs[d.argmin()]]
    ys, xs = np.nonzero(labels == label)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def overlaps(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def place_markers(meta: dict, rgb: np.ndarray):
    h, w, _ = rgb.shape
    dim_mask, gdt_mask = highlight_masks(rgb)
    dim_labels, _ = ndimage.label(dim_mask)
    gdt_labels, _ = ndimage.label(gdt_mask)
    marker = int(w * 0.022)   # 화면에서 마커가 차지하는 크기(이미지 px 기준 어림)
    gap = 3

    # 1) 항목별 글자(틀) 박스
    boxes = {}
    frame_rows = {}
    for item in meta["items"]:
        x, y = int(item["position"]["x"]), int(item["position"]["y"])
        if item["category"] == "GDT":
            box = box_near(gdt_labels, x + 15, y + 15, 40)
            frame = item.get("frame_id") or item["id"]
            frame_rows.setdefault(frame, []).append(item)
        else:
            box = box_near(dim_labels, x, y, 40)
        boxes[item["id"]] = box

    # 2) 박스 옆 빈 자리에 마커 배치 (다른 글자·마커와 안 겹치는 쪽)
    taken = [b for b in boxes.values() if b]
    for item in meta["items"]:
        box = boxes[item["id"]]
        x, y = item["position"]["x"], item["position"]["y"]
        if box is None:   # 하이라이트를 못 찾으면 좌표 오른쪽
            item["label_anchor"] = {"x": x, "y": y, "side": "right"}
            continue
        x1, y1, x2, y2 = box
        if item["category"] == "GDT":
            rows = sorted(frame_rows[item.get("frame_id") or item["id"]], key=lambda i: i.get("row_index") or 1)
            n, k = len(rows), rows.index(item)
            row_h = (y2 - y1) / n
            cy = y1 + row_h * (k + 0.5)
            order = ["left", "right"]
        else:
            cy = (y1 + y2) / 2
            vertical = (y2 - y1) > 1.6 * (x2 - x1)
            order = ["top", "bottom", "right", "left"] if vertical else ["right", "left", "top", "bottom"]
        cx = (x1 + x2) / 2
        spots = {
            "right": ({"x": x2, "y": cy}, [x2 + gap, cy - marker / 2, x2 + gap + marker, cy + marker / 2]),
            "left": ({"x": x1, "y": cy}, [x1 - gap - marker, cy - marker / 2, x1 - gap, cy + marker / 2]),
            "top": ({"x": cx, "y": y1}, [cx - marker / 2, y1 - gap - marker, cx + marker / 2, y1 - gap]),
            "bottom": ({"x": cx, "y": y2}, [cx - marker / 2, y2 + gap, cx + marker / 2, y2 + gap + marker]),
        }
        chosen = None
        for side in order:
            anchor, rect = spots[side]
            inside = rect[0] >= 0 and rect[1] >= 0 and rect[2] < w and rect[3] < h
            if inside and not any(overlaps(rect, t) for t in taken if t is not box):
                chosen = side
                break
        chosen = chosen or order[0]
        anchor, rect = spots[chosen]
        taken.append(rect)
        item["label_anchor"] = {"x": round(anchor["x"], 1), "y": round(anchor["y"], 1), "side": chosen}
        item["text_box"] = box


# ------------------------------------------------------------ 오류사례 DB
def export_cases():
    import openpyxl

    files = glob.glob(str(DATA / "error_cases" / "*.xlsx"))
    if not files:
        return 0
    wb = openpyxl.load_workbook(files[0], read_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    head = [str(c) for c in rows[0]]
    cases = [{k: ("" if v is None else v) for k, v in zip(head, r)} for r in rows[1:] if r and r[0]]
    for case in cases:
        case.pop("search_text", None)
        case["source_file"] = Path(files[0]).name
    (OUT / "error_cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(cases)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for path in sorted((DATA / "normalized").glob("*_metadata.json")):
        doc_id = path.name.replace("_metadata.json", "")
        meta = json.loads(path.read_text(encoding="utf-8-sig"))
        image = image_for(doc_id, meta)
        if image is None:
            print(f"[SKIP] {doc_id}: 도면 이미지 없음")
            continue

        for item in meta["items"]:
            fix = CORRECTIONS.get(doc_id, {}).get(item["id"])
            if fix:
                item.update(fix)
                item["requires_review"] = False
                item["review_reasons"] = [CORRECTION_NOTE]

        rgb = np.array(Image.open(image).convert("RGB"))
        if (rgb.shape[1], rgb.shape[0]) != (meta["image"]["width_px"], meta["image"]["height_px"]):
            print(f"[SKIP] {doc_id}: 이미지 크기와 JSON 크기가 다름")
            continue
        place_markers(meta, rgb)

        file_name = f"{doc_id}{image.suffix.lower()}"
        shutil.copyfile(image, OUT / file_name)
        meta["image"]["file"] = file_name
        meta["demo_id"] = doc_id
        (OUT / f"{doc_id}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        index.append({
            "id": doc_id,
            "label": f"{doc_id} · {meta.get('part_name') or '도면'}" if doc_id != "1" else "PR-04 · PISTON ROD (샘플)",
            "part_name": meta.get("part_name"),
            "part_no": meta.get("part_no"),
            "scale": meta.get("drawing_scale"),
            "data": f"{doc_id}.json",
        })
        print(f"[OK] {doc_id}: 항목 {len(meta['items'])}개")

    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[OK] 오류사례 {export_cases()}건 → error_cases.json")
    print(f"[SAVED] {OUT}")


if __name__ == "__main__":
    main()
