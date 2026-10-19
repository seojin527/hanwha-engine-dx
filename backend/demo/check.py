"""[시연용] 터미널에서 작업자처럼 검수해보기 (프론트 화면 없이).

    backend 폴더에서:
    python demo/check.py HDH_63_3 --frame-offset 56,56

1) 기하공차를 하나씩 보여줌 → 맞으면 Enter, 다르면 값 입력, b = 이전 항목으로
2) 빠진 치수가 있으면 추가
3) 저장 전 최종 확인 화면에서 번호로 다시 고치기 / 추가 치수 삭제 / 저장 안 하고 끝내기
4) 결과는 data/reviewed/ · data/logs/ 에 저장, 작업자 입력(edits.json)은 demo/output/ (샘플 원본은 그대로 둠)

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
import subprocess


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
    print("   맞으면 Enter / 다르면 맞는 값 입력 (예: 0.003) / b = 이전 항목으로\n")
    values: List[Optional[str]] = [None] * len(gdt)
    i = 0
    while i < len(gdt):
        answer = _ask_gdt(gdt, i, ask, allow_back=i > 0)
        if answer is BACK:
            i -= 1
            print("    ↩ 이전 항목으로 돌아감\n")
            continue
        values[i] = answer
        i += 1

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
        added.append(_ask_added(ask))

    # ---------------------------------------------------------- ③ 최종 확인 (저장 전에 다시 고치기)
    while True:
        _print_summary(gdt, values, added)
        cmd = _ask(" Enter = 저장 / 번호 = 그 기하공차 다시 입력 / a = 치수 추가 / d번호 = 추가 치수 삭제 / q = 저장 안 하고 끝 > ",
                   lambda a, n=len(gdt), m=len(added): _check_cmd(a, n, m), ask).lower()
        if cmd == "":
            break
        if cmd == "q":
            print("\n저장 안 하고 끝냄")
            return 130
        if cmd == "a":
            added.append(_ask_added(ask))
        elif cmd.startswith("d"):
            gone = added.pop(int(cmd[1:]) - 1)
            print(f"    ✗ 삭제: {KIND_PREFIX[gone['kind']]}{gone['value']} @ ({gone['x']}, {gone['y']})")
        else:
            k = int(cmd) - 1
            answer = _ask_gdt(gdt, k, ask, allow_back=False, current=values[k])
            values[k] = answer
    decided = [{"item_id": g["item_id"], "value": v} for g, v in zip(gdt, values)]

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
              "review_history.csv": "누적 기록, 엑셀로 열기", "_reviewed.jpg": "검수 끝난 도면 (추가 치수 형광펜)", "_edits_log.jpg": "수정 기록 이미지 (OK/FIX/ADD)"}
    print(f"\n[SAVED] {edits_path}   (작업자 수정 내용)")
    for path in saved:
        label = next((v for k, v in labels.items() if path.endswith(k)), "")
        print(f"[SAVED] {path}   ({label})")
    return 0


BACK = object()  # "이전 항목으로" 표시


def _ask_gdt(gdt: List[dict], i: int, ask, allow_back: bool, current: Optional[str] = None):
    """기하공차 한 줄 확인 → 확정 값 (allow_back 이고 b 입력이면 BACK)"""
    g = gdt[i]
    datum = " ".join(g["datums"]) or "-"
    now = f"  | 지금 확정 값: {current}" if current is not None else ""
    print(f" ({i + 1}/{len(gdt)}) {g['item_id']}  {g['symbol']} {g['symbol_name'] or '기호?'}"
          f"  | OCR 값: {g['value'] or '(없음)'}  | 데이텀: {datum}{now}")
    must_type = g["status"] == "format_error"
    if must_type:
        print(f"    ⚠ 형식 오류: {g['message']} → 값을 직접 입력해야 함")

    def check(a):
        if a.lower() == "b" and allow_back:
            return None
        if a == "" and not must_type:
            return None
        if INPUT_VALUE_RE.match(a):
            return None
        return "숫자로 입력하세요 (예: 0.01)" if must_type else "Enter 또는 숫자 (예: 0.003)"

    answer = _ask("    > ", check, ask)
    if answer.lower() == "b":
        return BACK
    value = answer or g["value"]
    mark = "그대로 확정" if value == g["value"] else f"수정 {g['value']} → {value}"
    print(f"    ✓ {mark}\n")
    return value


def _ask_added(ask) -> dict:
    """빠진 치수 하나 입력 → added_dimensions 항목"""
    value = _ask("    치수 값 (예: 7) > ", lambda a: None if INPUT_VALUE_RE.match(a) else "숫자로 입력하세요", ask)
    print("    종류: " + "  ".join(f"{n}) {label}" for n, (_, label) in enumerate(KINDS, 1)))
    kind_no = _ask("    번호 (Enter = 1 길이) > ",
                   lambda a: None if a in ("", "1", "2", "3", "4", "5") else "1~5 중 하나", ask)
    kind = KINDS[int(kind_no or 1) - 1][0]
    tol_raw = _ask("    공차 (Enter = 일반공차 / ±0.02 / +0.02/-0.01) > ", _check_tol, ask)
    pos = _ask("    도면 위치 x,y (색칠 이미지 픽셀, 예: 1267,1103) > ",
               lambda a: None if re.fullmatch(r"\s*\d+\s*,\s*\d+\s*", a) else "x,y 형식 (예: 1267,1103)", ask)
    x, y = (int(v) for v in pos.split(","))
    print(f"    ✓ 추가: {KIND_PREFIX[kind]}{value}  ({tol_raw or '일반공차'}) @ ({x}, {y})")
    return {"value": value, "kind": kind, "tolerance": _parse_tol(tol_raw), "x": x, "y": y, "coord": "image"}


def _print_summary(gdt: List[dict], values: List[str], added: List[dict]) -> None:
    print("\n" + "-" * 64)
    print(" [ ③ 최종 확인 ]  저장하기 전에 한 번 더 보세요")
    print("-" * 64)
    for i, (g, v) in enumerate(zip(gdt, values), 1):
        mark = "그대로" if v == g["value"] else f"수정 ({g['value'] or '없음'} → {v})"
        print(f"  {i:>2}. {g['symbol']} {g['symbol_name'] or '':<5} {v:<8} {mark}")
    if added:
        print("  추가 치수:")
        for k, a in enumerate(added, 1):
            print(f"  d{k}. {KIND_PREFIX[a['kind']]}{a['value']} @ ({a['x']}, {a['y']})")
    else:
        print("  추가 치수: 없음")
    print("-" * 64)


def _check_cmd(a: str, n: int, m: int) -> Optional[str]:
    a = a.lower()
    if a in ("", "a", "q"):
        return None
    if a.isdigit() and 1 <= int(a) <= n:
        return None
    if a.startswith("d") and a[1:].isdigit() and 1 <= int(a[1:]) <= m:
        return None
    return f"Enter / 1~{n} / a / " + (f"d1~d{m} / " if m else "") + "q 중 하나"


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
    # 작업자 검수 전 OCR 분석 데이터 자동 생성
    print("[PREPARE] OCR 검수 데이터 생성 중...")

    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "ocr_review",
                "review",
                origin_path,  # 이름만 주면 data 폴더만 찾아서 demo/samples 도면은 못 찾음 → 경로를 그대로 넘김
            ],
            cwd=os.path.dirname(DEMO_DIR),
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] 검수 데이터 생성 실패: {e}")
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
