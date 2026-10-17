"""파일 찾기·읽기·저장 (명령줄, 시연 스크립트가 같이 씀)."""
from __future__ import annotations

import json
import os
from typing import List, Optional

from .logs import write_logs
from .review import build_reviewed_json

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DATA_DIR = os.path.normpath(os.path.join(BACKEND_DIR, "..", "data"))  # 수정이 eDOCr2 결과 폴더


def find_origin(arg: str, extra_folders: Optional[List[str]] = None) -> str:
    """'HDH_63_3' 처럼 도면 이름만 주면 HDH_63_3_origin.txt 를 찾는다.

    찾는 순서: 그대로 → extra_folders → data/ → 레포의 data 폴더
    """
    if os.path.isfile(arg):
        return arg
    names = [arg] if arg.lower().endswith(".txt") else [f"{arg}_origin.txt", f"{arg}_OCR.txt", f"{arg}.txt"]
    folders = list(extra_folders or []) + ["", "data", REPO_DATA_DIR]
    for folder in folders:
        for n in names:
            path = os.path.normpath(os.path.join(folder, n))
            if os.path.isfile(path):
                return path
    raise FileNotFoundError(f"'{arg}' 를 찾지 못함 ({', '.join(names)} 를 {', '.join(f or '현재 폴더' for f in folders)} 에서 확인)")


def base_of(path: str) -> str:
    """'data/HDH_63_3_origin.txt' → 'data/HDH_63_3'"""
    stem = os.path.splitext(path)[0]
    for suffix in ("_origin", "_OCR", "_ocr"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return f.read()


def write_text(path: str, text: str) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def save_outputs(origin_path: str, base: str, name: str, reviewed: str, log: dict, *,
                 out: Optional[str] = None, want_json: bool = False, log_dir: Optional[str] = "logs",
                 result_jpg: Optional[str] = None) -> List[str]:
    """검수 결과 저장. 저장한 경로 목록을 돌려준다.

    도면_reviewed.txt (항상) / 도면_reviewed.json (want_json) / 도면_review_log.txt·json (항상)
    log_dir/review_history.csv (누적) / 도면_reviewed.jpg (result_jpg, 없으면 옆의 도면_result.jpg 자동)
    """
    out = out or base + "_reviewed.txt"
    write_text(out, reviewed)
    saved = [out]
    if want_json:
        path = base + "_reviewed.json"
        write_text(path, json.dumps(build_reviewed_json(reviewed, log, name), ensure_ascii=False, indent=2) + "\n")
        saved.append(path)
    saved += write_logs(log, base, log_dir or None, origin_file=origin_path, reviewed_file=out)
    if result_jpg is None:
        auto = base_of(origin_path) + "_result.jpg"
        result_jpg = auto if os.path.isfile(auto) else None
    if result_jpg:
        try:
            from .render import render_reviewed
            saved.append(render_reviewed(result_jpg, reviewed, log, base + "_reviewed.jpg"))
        except ImportError:
            print("  ! Pillow가 없어 reviewed.jpg 는 건너뜀 (pip install pillow)")
    return saved
