"""파일 찾기·읽기·저장 (명령줄, 시연 스크립트가 같이 씀)."""
from __future__ import annotations

import json
import os
from typing import List, Optional

from .logs import write_logs
from .review import build_reviewed_json

from paths import DATA_DIR as _DATA_DIR, ORIGIN_DIR as _ORIGIN_DIR

REPO_DATA_DIR = str(_DATA_DIR)  # 수정이 eDOCr2 결과 폴더
ORIGIN_DIR = str(_ORIGIN_DIR)

def find_origin(arg: str, extra_folders: Optional[List[str]] = None) -> str:
    """'HDH_63_3' 처럼 도면 이름만 주면 HDH_63_3_origin.txt 를 찾는다.

    찾는 순서: 그대로 → extra_folders → data/ → 레포의 data 폴더
    """
    if os.path.isfile(arg):
        return arg
    names = [arg] if arg.lower().endswith(".txt") else [f"{arg}_origin.txt", f"{arg}_OCR.txt", f"{arg}.txt"]
    folders = list(extra_folders or []) + [
    "",
    ORIGIN_DIR,
    "data",
    REPO_DATA_DIR,
    ]
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
    """검수 완료 파일을 reviewed/, 검수 기록을 logs/에 저장."""

    # 프로젝트 data 폴더 기준 경로
    reviewed_dir = os.path.join(REPO_DATA_DIR, "reviewed")
    logs_dir = os.path.join(REPO_DATA_DIR, "logs")

    os.makedirs(reviewed_dir, exist_ok=True)
    os.makedirs(logs_dir, exist_ok=True)

    reviewed_base = os.path.join(reviewed_dir, name)
    logs_base = os.path.join(logs_dir, name)

    # 1. 검수 완료 TXT: 원본 OCR TXT 형식 유지
    out = out or reviewed_base + "_reviewed.txt"
    write_text(out, reviewed)
    saved = [out]

    # 2. 선택적 검수 완료 JSON
    if want_json:
        path = reviewed_base + "_reviewed.json"
        write_text(
            path,
            json.dumps(
                build_reviewed_json(reviewed, log, name),
                ensure_ascii=False,
                indent=2
            ) + "\n"
        )
        saved.append(path)

    # 3. 검수 이력
    saved += write_logs(
        log,
        logs_base,
        logs_dir if log_dir else None,
        origin_file=origin_path,
        reviewed_file=out
    )

    # 4. 검수 결과 이미지
    if result_jpg is None:
        auto = base_of(origin_path) + "_result.jpg"
        result_jpg = auto if os.path.isfile(auto) else None

    if result_jpg:
        try:
            from .render import render_edits_log, render_reviewed
            # 검수 끝난 도면: 못 읽어서 추가한 치수만 형광펜 → reviewed/
            saved.append(
                render_reviewed(
                    result_jpg,
                    reviewed,
                    log,
                    reviewed_base + "_reviewed.jpg"
                )
            )
            # 수정 기록 이미지 (OK / FIX / ADD 라벨) → logs/
            saved.append(
                render_edits_log(
                    result_jpg,
                    reviewed,
                    log,
                    logs_base + "_edits_log.jpg"
                )
            )
        except ImportError:
            print("  ! Pillow가 없어 reviewed.jpg / edits_log.jpg 는 건너뜀 (pip install pillow)")

    return saved