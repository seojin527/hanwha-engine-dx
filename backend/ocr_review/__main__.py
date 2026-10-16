"""명령줄 실행 (실제 프로젝트용).

    python -m ocr_review review  HDH_63_3                 → 도면_review.json   (프론트에 줄 확인 목록)
    python -m ocr_review apply   HDH_63_3 도면_edits.json  → 도면_reviewed.txt  + 검수 기록

도면 이름만 주면 레포의 data 폴더에서 도면_origin.txt 를 찾는다 (파일 경로를 줘도 됨).
결과도 같은 폴더에 저장한다.

apply 가 남기는 파일
    도면_reviewed.txt        고쳐진 TXT (원본과 같은 형식)        ← 결과
    도면_reviewed.json       같은 내용을 정리한 JSON               ← --json 줄 때만
    도면_review_log.txt      사람이 읽는 이번 검수 기록
    도면_review_log.json     같은 기록 (프로그램용)
    logs/review_history.csv  모든 검수가 계속 쌓이는 누적 기록
    도면_reviewed.jpg        고친 곳 표시 이미지 (도면_result.jpg 가 옆에 있으면 자동)

시연(터미널에서 직접 검수)은 demo/check.py 를 쓴다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from .files import base_of, find_origin, read_text, save_outputs, write_text
from .review import ReviewError, apply_review, build_review
from .txt_format import TxtFormatError


def fix_console() -> None:
    """윈도우 터미널에서 기호(⏥ ⌖ 등) 출력 오류 방지"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ocr_review", description="eDOCr2 OCR 결과 검수")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("review", help="원본 TXT → 검수 화면용 JSON")
    r.add_argument("origin", help="도면 이름(HDH_63_3) 또는 도면_origin.txt 경로")
    r.add_argument("-o", "--out")

    a = sub.add_parser("apply", help="원본 TXT + 작업자 수정 JSON → 고쳐진 TXT + 검수 기록")
    a.add_argument("origin", help="도면 이름(HDH_63_3) 또는 도면_origin.txt 경로")
    a.add_argument("edits_json")
    a.add_argument("-o", "--out", help="고쳐진 TXT 경로 (기본: 도면_reviewed.txt)")
    a.add_argument("--json", action="store_true", help="고쳐진 결과를 JSON으로도 저장")
    a.add_argument("--log-dir", default="logs", help="누적 기록 폴더 (기본: logs, 빈 값이면 안 남김)")
    a.add_argument("--result-jpg", help="색칠 결과 이미지 (기본: 도면_result.jpg 가 옆에 있으면 자동)")
    a.add_argument("--dpi", type=int, default=200, help="Image size 줄에 dpi가 없으면 붙일 값 (0=안 붙임)")
    a.add_argument("--allow-incomplete", action="store_true", help="확정 안 한 기하공차가 있어도 저장")

    fix_console()
    args = p.parse_args(argv)
    try:
        origin_path = find_origin(args.origin)
        base = base_of(origin_path)
        name = os.path.basename(base)
        origin = read_text(origin_path)
        print(f"[INPUT] {origin_path}")

        if args.cmd == "review":
            out = args.out or base + "_review.json"
            data = build_review(origin, name=name)
            write_text(out, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            s = data["summary"]
            print(f"[SAVED] {out}  (기하공차 {s['gdt_rows']}줄, 형식 오류 {s['gdt_format_error']}, 치수 {s['dimensions']})")
            for w in data["warnings"]:
                print("  ! " + w)
            return 0

        with open(args.edits_json, "r", encoding="utf-8-sig") as f:
            edits = json.load(f)
        reviewed, log = apply_review(origin, edits, name=name, dpi=args.dpi or None,
                                     require_all=not args.allow_incomplete)
        s = log["summary"]
        print(f"  기하공차 {s['gdt_rows']}줄: 그대로 {s['gdt_confirmed']}, 수정 {s['gdt_edited']}, 미확정 {s['gdt_unreviewed']}"
              f" / 치수 {s['dimensions_ocr']} + 추가 {s['dimensions_added']}")
        for w in log["warnings"]:
            print("  ! " + w)
        for path in save_outputs(origin_path, base, name, reviewed, log, out=args.out, want_json=args.json,
                                 log_dir=args.log_dir, result_jpg=args.result_jpg):
            print(f"[SAVED] {path}")
        return 0
    except ReviewError as e:
        print("[ERROR] 수정 내용을 반영할 수 없음:", file=sys.stderr)
        for m in e.errors:
            print("  - " + m, file=sys.stderr)
        return 2
    except (TxtFormatError, OSError, json.JSONDecodeError) as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
