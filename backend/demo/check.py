"""[시연용] 터미널에서 작업자처럼 검수해보기 (프론트 화면 없이).

    backend 폴더에서:
    python demo/check.py HDH_63_3 --frame-offset 56,56

1) 기하공차를 하나씩 보여줌 → 맞으면 Enter, 다르면 값 입력
2) 빠진 치수가 있으면 추가
3) 결과는 demo/output/ 폴더에 저장 (샘플 원본은 그대로 둠)

도면 찾는 순서: demo/samples → 레포의 data 폴더
실제 프로젝트 코드는 ocr_review/ 이고, 이 파일은 그걸 불러다 쓰기만 한다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Callable, List, Optional

DEMO_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(DEMO_DIR))  # backend 폴더 → ocr_review 를 불러올 수 있게

from ocr_review.files import base_of, find_origin, read_text, save_outputs  # noqa: E402
from ocr_review.review import INPUT_VALUE_RE, KIND_PREFIX, ReviewError, apply_review, build_review  # noqa: E402

KINDS = [("length", "길이"), ("diameter", "지름 ⌀"), ("radius", "반경 R"), ("chamfer", "모따기 C"), ("thread", "나사 M")]


def _ask(prompt: str, check: Callable[[str], Optional[str]], ask=input) -> str:
    """check(answer) 가 오류 메시지를 돌려주면 다시 묻는다."""
    while True:
        answer = ask(prompt).strip()
        err = check(answer)
        if err is None:
            return answer
        print(f"    ! {err}")


def run_check(origin_txt: str, name: str, edits_path: str, save: Callable[[str, dict], list],
              dpi: Optional[int] = 200, frame_offset: Optional[List[int]] = None, ask=input) -> int:
    """save(reviewed_txt, log) → 저장한 경로 목록 (__main__.save_outputs 사용)"""
    review = build_review(origin_txt, name=name)
    gdt = review["gdt"]
    dims = review["dimensions"]
    line = "=" * 64

    print(line)
    print(f" OCR 검수 실험 : {name}")
    print(f" 기하공차 {len(gdt)}줄 (형식 오류 {review['summary']['gdt_format_error']}) · 치수 {len(dims)}개")
    print(line)
    reviewer = ask(" 작업자 이름 (Enter = 작업자) > ").strip() or "작업자"

    # ---------------------------------------------------------- ① 기하공차
    print("\n[ ① 기하공차 검토 ]  도면 원본을 보고 확인하세요")
    print("   맞으면 Enter / 다르면 맞는 값 입력 (예: 0.003)\n")
    decided: List[dict] = []
    for i, g in enumerate(gdt, 1):
        datum = " ".join(g["datums"]) or "-"
        print(f" ({i}/{len(gdt)}) {g['item_id']}  {g['symbol']} {g['symbol_name'] or '기호?'}"
              f"  | OCR 값: {g['value'] or '(없음)'}  | 데이텀: {datum}")
        if g["status"] == "format_error":
            print(f"    ⚠ 형식 오류: {g['message']} → 값을 직접 입력해야 함")

            def check(a, _g=g):
                return None if INPUT_VALUE_RE.match(a) else "숫자로 입력하세요 (예: 0.01)"
        else:
            def check(a, _g=g):
                return None if (a == "" or INPUT_VALUE_RE.match(a)) else "Enter 또는 숫자 (예: 0.003)"
        answer = _ask("    > ", check, ask)
        value = answer or g["value"]
        mark = "그대로 확정" if value == g["value"] else f"수정 {g['value']} → {value}"
        print(f"    ✓ {mark}\n")
        decided.append({"item_id": g["item_id"], "value": value})

    # ---------------------------------------------------------- ② 치수
    print("[ ② 치수 검토 ]  인식된 치수는 그대로 사용합니다")
    texts = [f"{d['no']:>2}. {d['text']}" for d in dims]
    for k in range(0, len(texts), 4):
        print("   " + "    ".join(t.ljust(12) for t in texts[k:k + 4]))
    added: List[dict] = []
    while True:
        more = _ask("\n 도면에 있는데 위 목록에 없는 치수가 있나요? (y = 추가 / Enter = 없음) > ",
                    lambda a: None if a.lower() in ("", "y", "n") else "y 또는 Enter", ask).lower()
        if more != "y":
            break
        value = _ask("    치수 값 (예: 7) > ", lambda a: None if INPUT_VALUE_RE.match(a) else "숫자로 입력하세요", ask)
        print("    종류: " + "  ".join(f"{n}) {label}" for n, (_, label) in enumerate(KINDS, 1)))
        kind_no = _ask("    번호 (Enter = 1 길이) > ",
                       lambda a: None if a in ("", "1", "2", "3", "4", "5") else "1~5 중 하나", ask)
        kind = KINDS[int(kind_no or 1) - 1][0]
        tol_raw = _ask("    공차 (Enter = 일반공차 / ±0.02 / +0.02/-0.01) > ", _check_tol, ask)
        pos = _ask("    도면 위치 x,y (색칠 이미지 픽셀, 예: 1267,1103) > ",
                   lambda a: None if re.fullmatch(r"\s*\d+\s*,\s*\d+\s*", a) else "x,y 형식 (예: 1267,1103)", ask)
        x, y = (int(v) for v in pos.split(","))
        item = {"value": value, "kind": kind, "tolerance": _parse_tol(tol_raw), "x": x, "y": y, "coord": "image"}
        added.append(item)
        print(f"    ✓ 추가: {KIND_PREFIX[kind]}{value}  ({tol_raw or '일반공차'}) @ ({x}, {y})")

    # ---------------------------------------------------------- 저장 + 반영
    edits = {"reviewer": reviewer, "gdt": decided, "added_dimensions": added}
    if frame_offset:
        edits["frame_offset"] = frame_offset
    os.makedirs(os.path.dirname(os.path.abspath(edits_path)), exist_ok=True)
    with open(edits_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(edits, ensure_ascii=False, indent=2) + "\n")
    try:
        reviewed, log = apply_review(origin_txt, edits, name=name, dpi=dpi)
    except ReviewError as e:
        print("\n[ERROR] 반영 실패:")
        for m in e.errors:
            print("  - " + m)
        return 2
    saved = save(reviewed, log)

    s = log["summary"]
    print("\n" + line)
    print(" 결과")
    print(line)
    print(f" 기하공차 {s['gdt_rows']}줄: 그대로 {s['gdt_confirmed']} · 수정 {s['gdt_edited']}")
    print(f" 치수: 인식 {s['dimensions_ocr']} + 추가 {s['dimensions_added']}")
    for c in log["changes"]:
        if c["action"] == "edited":
            print(f"   - {c['item_id']}: {c['before']}  →  {c['after']}")
        elif c["action"] == "added":
            print(f"   + {c['item_id']}: {c['after']} 추가")
    for w in log["warnings"]:
        print(f" ! {w}")
    labels = {"_reviewed.txt": "결과: 고쳐진 TXT", "_reviewed.json": "결과: 고쳐진 JSON",
              "_review_log.txt": "검수 기록, 읽기용", "_review_log.json": "검수 기록, 프로그램용",
              "review_history.csv": "누적 기록, 엑셀로 열기", "_reviewed.jpg": "고친 곳 표시 이미지"}
    print(f"\n[SAVED] {edits_path}   (작업자 수정 내용)")
    for path in saved:
        label = next((v for k, v in labels.items() if path.endswith(k)), "")
        print(f"[SAVED] {path}   ({label})")
    return 0


def _check_tol(a: str) -> Optional[str]:
    if a == "" or re.fullmatch(r"±\s*\d+(\.\d+)?", a) or re.fullmatch(r"\+?\d+(\.\d+)?\s*/\s*-?\d+(\.\d+)?", a):
        return None
    return "Enter, ±0.02, +0.02/-0.01 중 하나 형식"


def _parse_tol(a: str) -> dict:
    if not a:
        return {"type": "general"}
    if a.startswith("±"):
        return {"type": "symmetric", "value": a[1:].strip()}
    up, lo = (v.strip() for v in a.split("/"))
    return {"type": "deviation", "upper": up, "lower": lo}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="demo/check.py", description="[시연용] 터미널에서 작업자처럼 검수")
    p.add_argument("origin", help="도면 이름 (HDH_61_2 / HDH_62_2 / HDH_63_3) 또는 도면_origin.txt 경로")
    p.add_argument("--frame-offset", help="도면 테두리 차이값 x,y (HDH 도면은 56,56)")
    p.add_argument("--json", action="store_true", help="고쳐진 결과를 JSON으로도 저장")
    p.add_argument("--out-dir", default=os.path.join(DEMO_DIR, "output"), help="결과 저장 폴더 (기본: demo/output)")
    args = p.parse_args(argv)

    from ocr_review.__main__ import fix_console
    fix_console()
    try:
        origin_path = find_origin(args.origin, extra_folders=[os.path.join(DEMO_DIR, "samples")])
    except FileNotFoundError as e:
        print(f"[ERROR] {e}")
        return 1
    name = os.path.basename(base_of(origin_path))
    base = os.path.join(args.out_dir, name)
    offset = [int(v) for v in args.frame_offset.replace(" ", "").split(",")] if args.frame_offset else None
    print(f"[INPUT] {origin_path}")

    def save(reviewed, log):
        return save_outputs(origin_path, base, name, reviewed, log, want_json=args.json,
                            log_dir=os.path.join(args.out_dir, "logs"))

    try:
        return run_check(read_text(origin_path), name, base + "_edits.json", save, frame_offset=offset)
    except (KeyboardInterrupt, EOFError):
        print("\n중단함 (저장 안 함)")
        return 130


if __name__ == "__main__":
    sys.exit(main())
