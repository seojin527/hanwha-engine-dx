"""발표 서버에 올릴 데이터 사본(tar.gz) 만들기. 원본 데이터(storage/·vector_db/·data/)는 바꾸지 않는다.

실행 (backend 폴더에서, 로컬 서버를 멈춘 상태):
    .venv\\Scripts\\python.exe tools\\export_demo_bundle.py --list
        부품별 도면·OCR·검토·측정 건수와 3D 연결 상태만 출력
    .venv\\Scripts\\python.exe tools\\export_demo_bundle.py --exclude-part <part_id> ... --dry-run
        뺄 부품에 딸린 도면·기록·파일 건수만 출력 (사본을 만들지 않음)
    .venv\\Scripts\\python.exe tools\\export_demo_bundle.py --exclude-part <part_id> ...
        ..\\backups\\demo-bundle-<시각>.tar.gz 생성
    --rename-part <part_id>=<새 이름>   사본에서만 부품 이름을 바꾼다 (검토 완료 도면이 든 임시 이름 부품 등)

- 임시 폴더에 사본을 만든 뒤 사본에서만 부품·도면·연결 기록·파일을 지운다.
- 담는 것: storage/(검증용 하위 폴더 제외) · vector_db/ · data/. 서버의 deploy/restore.sh 가 같은 구조를 푼다.
- 자동 OCR 이 data/origin 으로 복사하기 전에 처리된 도면은 마지막 완료 OCR 작업 폴더의 TXT·JPG 를 사본에 채운다.
- 3D 유형 연결·관리자 검토는 자동으로 하지 않는다 (관리자 주소에서 직접).
"""

import argparse
import json
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import DATA_DIR, LIBRARY_DB, STORAGE_DIR, VECTOR_DB_DIR  # noqa: E402
from tools.backup_local_data import BACKUP_ROOT, manifest, server_running  # noqa: E402

# 로컬 환경 검증 때 만든 DB 사본들. 발표 서버에는 필요 없다.
SKIP_STORAGE = {"environment-verification", "ui-verification"}
# 도면 ID 이름으로 파일이 쌓이는 data 하위 폴더
DRAWING_DATA_DIRS = ("origin", "reviewed", "logs")
HISTORY_CSV = Path("logs") / "review_history.csv"


def connect_ro(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)


def tables_with(db: sqlite3.Connection, column: str) -> list[str]:
    names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    return [name for name in names if column in {row[1] for row in db.execute(f'PRAGMA table_info("{name}")')}]


def part_report(db: sqlite3.Connection) -> list[dict]:
    columns = {row[1] for row in db.execute("PRAGMA table_info(parts)")}
    key = "p.engine_part_key" if "engine_part_key" in columns else "NULL"
    of_part = "(SELECT drawing_id FROM drawings WHERE part_id = p.part_id)"
    rows = db.execute(
        f"""SELECT p.part_id, p.name, {key},
                   (SELECT COUNT(*) FROM drawings WHERE part_id = p.part_id),
                   (SELECT COUNT(*) FROM ocr_results WHERE drawing_id IN {of_part}),
                   (SELECT COUNT(*) FROM ocr_results WHERE drawing_id IN {of_part} AND metadata_json LIKE '%"reviewed_txt"%'),
                   (SELECT COUNT(*) FROM measurement_attempts WHERE drawing_id IN {of_part})
            FROM parts p ORDER BY p.name"""
    ).fetchall()
    return [
        {"part_id": r[0], "name": r[1], "engine_part_key": r[2], "drawings": r[3],
         "with_ocr": r[4], "reviewed": r[5], "measurement_attempts": r[6]}
        for r in rows
    ]


def exclusion_plan(db: sqlite3.Connection, part_ids: list[str]) -> dict:
    """뺄 부품에 딸린 도면 ID, 테이블별 행 수, 파일 목록 (DB·파일은 읽기만)."""
    known = {row[0] for row in db.execute("SELECT part_id FROM parts")}
    unknown = [part for part in part_ids if part not in known]
    if unknown:
        raise SystemExit(f"없는 부품 ID: {', '.join(unknown)}  (--list 로 확인)")
    marks = ",".join("?" * len(part_ids))
    drawings = db.execute(f"SELECT drawing_id, stored_filename FROM drawings WHERE part_id IN ({marks})", part_ids).fetchall()
    drawing_ids = [row[0] for row in drawings]
    dmarks = ",".join("?" * len(drawing_ids))
    rows: dict[str, int] = {}
    files = [STORAGE_DIR / "uploads" / stored for _, stored in drawings if stored]
    jobs = []
    if drawing_ids:
        for table in tables_with(db, "drawing_id"):
            count = db.execute(f'SELECT COUNT(*) FROM "{table}" WHERE drawing_id IN ({dmarks})', drawing_ids).fetchone()[0]
            if count:
                rows[table] = count
        files += [STORAGE_DIR / "ocr_results" / name for (name,) in db.execute(
            f"SELECT image_filename FROM ocr_results WHERE drawing_id IN ({dmarks})", drawing_ids)]
        jobs = [STORAGE_DIR / "ocr_jobs" / job for (job,) in db.execute(
            f"SELECT job_id FROM ocr_jobs WHERE drawing_id IN ({dmarks})", drawing_ids)]
    # 다른 부품으로 옮겨졌던 기록 (from/to 로만 연결된 경우 포함)
    moves = 0
    if "drawing_part_moves" in tables_with(db, "from_part_id"):
        moves = db.execute(
            f"SELECT COUNT(*) FROM drawing_part_moves WHERE from_part_id IN ({marks}) OR to_part_id IN ({marks})",
            part_ids * 2,
        ).fetchone()[0]
    for folder in DRAWING_DATA_DIRS:
        for drawing_id in drawing_ids:
            files += sorted((DATA_DIR / folder).glob(f"{drawing_id}_*"))
    return {
        "parts": part_ids,
        "drawing_ids": drawing_ids,
        "rows": rows,
        "part_moves": moves,
        "files": [path for path in files if path.is_file()],
        "job_dirs": [path for path in jobs if path.is_dir()],
    }


def _stage_path(stage: Path, path: Path) -> Path | None:
    for root, name in ((STORAGE_DIR, "storage"), (DATA_DIR, "data")):
        try:
            return stage / name / path.relative_to(root)
        except ValueError:
            continue
    return None


def apply_exclusion(stage: Path, db_copy: Path, plan: dict) -> None:
    """임시 사본(stage, db_copy)에서만 지운다."""
    with sqlite3.connect(db_copy) as db:
        ids = plan["drawing_ids"]
        if ids:
            marks = ",".join("?" * len(ids))
            for table in tables_with(db, "drawing_id"):
                if table != "drawings":
                    db.execute(f'DELETE FROM "{table}" WHERE drawing_id IN ({marks})', ids)
            db.execute(f"DELETE FROM drawings WHERE drawing_id IN ({marks})", ids)
        pmarks = ",".join("?" * len(plan["parts"]))
        if "drawing_part_moves" in tables_with(db, "from_part_id"):
            db.execute(f"DELETE FROM drawing_part_moves WHERE from_part_id IN ({pmarks}) OR to_part_id IN ({pmarks})", plan["parts"] * 2)
        db.execute(f"DELETE FROM parts WHERE part_id IN ({pmarks})", plan["parts"])
        problems = db.execute("PRAGMA foreign_key_check").fetchall()
    if problems:
        raise SystemExit(f"사본 DB 에 끊긴 참조가 남았습니다: {problems[:5]}")
    for path in plan["files"]:
        target = _stage_path(stage, path)
        if target and target.is_file():
            target.unlink()
    for path in plan["job_dirs"]:
        target = _stage_path(stage, path)
        if target and target.is_dir():
            shutil.rmtree(target)
    history = stage / "data" / HISTORY_CSV
    if history.is_file() and plan["drawing_ids"]:
        lines = history.read_text(encoding="utf-8-sig").splitlines(keepends=True)
        kept = lines[:1] + [line for line in lines[1:] if not any(i in line for i in plan["drawing_ids"])]
        history.write_text("".join(kept), encoding="utf-8-sig")


def restore_missing_origin(stage: Path, db_copy: Path) -> int:
    """data/origin 에 <도면ID>_origin.txt·_result.jpg 가 없는 OCR 완료 도면은 마지막 완료 작업 폴더의 파일을 쓴다."""
    with connect_ro(db_copy) as db:
        rows = db.execute(
            """SELECT j.drawing_id, j.job_id, d.stored_filename FROM ocr_jobs j JOIN drawings d USING (drawing_id)
               WHERE j.status = 'completed' AND j.drawing_id IN (SELECT drawing_id FROM ocr_results)
               ORDER BY j.rowid"""
        ).fetchall()
    latest = {drawing_id: (job_id, Path(stored).stem) for drawing_id, job_id, stored in rows}
    origin = stage / "data" / "origin"
    origin.mkdir(parents=True, exist_ok=True)
    count = 0
    for drawing_id, (job_id, stem) in latest.items():
        for suffix in ("_origin.txt", "_result.jpg"):
            source = stage / "storage" / "ocr_jobs" / job_id / f"{stem}{suffix}"
            target = origin / f"{drawing_id}{suffix}"
            if not target.is_file() and source.is_file():
                shutil.copy2(source, target)
                count += 1
    return count


def parse_renames(values: list[str], known: set[str]) -> dict[str, str]:
    renames = {}
    for value in values:
        part_id, _, name = value.partition("=")
        if not name.strip() or part_id not in known:
            raise SystemExit(f"--rename-part 형식은 <part_id>=<새 이름> 이고 부품이 있어야 합니다: {value}")
        renames[part_id] = name.strip()
    return renames


def print_parts(rows: list[dict]) -> None:
    print("부품별 도면 · OCR · 검토완료 · 측정시도 · 3D 연결:")
    for row in rows:
        link = row["engine_part_key"] or "미연결"
        print(f"  - {row['name']}: 도면 {row['drawings']} · OCR {row['with_ocr']} · 검토완료 {row['reviewed']} · "
              f"측정시도 {row['measurement_attempts']} · 3D={link}  id={row['part_id']}")


def print_plan(plan: dict) -> None:
    print(f"\n제외 부품 {len(plan['parts'])}개 → 도면 {len(plan['drawing_ids'])}건")
    for table, count in sorted(plan["rows"].items()):
        print(f"  - {table}: {count}행")
    if plan["part_moves"]:
        print(f"  - drawing_part_moves (from/to): {plan['part_moves']}행")
    print(f"  - 파일 {len(plan['files'])}개, OCR 작업 폴더 {len(plan['job_dirs'])}개 (+ review_history.csv 의 해당 도면 행)")
    records = [t for t in plan["rows"] if t.endswith(("_case_links", "point_error_reports", "measurement_records", "machining_stage_records", "measurement_attempts"))]
    if records:
        print(f"  ! 측정·오류사례 연결 기록이 있습니다 ({', '.join(records)}). 테스트용이 맞는지 확인하세요. 오류사례 원문·벡터DB 는 남깁니다.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="발표용 데이터 사본 만들기 (원본 변경 없음)")
    parser.add_argument("--list", action="store_true", help="부품별 현황만 출력")
    parser.add_argument("--exclude-part", action="append", default=[], metavar="PART_ID", help="사본에서 뺄 부품 (여러 번 지정)")
    parser.add_argument("--rename-part", action="append", default=[], metavar="PART_ID=NAME", help="사본에서 부품 이름 변경")
    parser.add_argument("--dry-run", action="store_true", help="제외 영향만 출력하고 사본은 만들지 않음")
    args = parser.parse_args(argv)
    if not LIBRARY_DB.is_file():
        raise SystemExit(f"DB 가 없습니다: {LIBRARY_DB}")

    with connect_ro(LIBRARY_DB) as db:
        print_parts(part_report(db))
        plan = exclusion_plan(db, args.exclude_part) if args.exclude_part else None
        renames = parse_renames(args.rename_part, {row[0] for row in db.execute("SELECT part_id FROM parts")})
    if set(renames) & set(args.exclude_part):
        raise SystemExit("같은 부품을 제외하면서 이름을 바꿀 수 없습니다.")
    if plan:
        print_plan(plan)
    for part_id, name in renames.items():
        print(f"  이름 변경(사본만): {part_id} → {name}")
    if args.list or args.dry_run:
        return 0

    if server_running():
        raise SystemExit("\n서버(127.0.0.1:8000)가 실행 중입니다. 멈춘 뒤 다시 실행하세요. (실행 중인 Chroma 폴더는 복사하지 않음)")
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    target = BACKUP_ROOT / time.strftime("demo-bundle-%Y%m%d-%H%M%S.tar.gz")
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        ignore = shutil.ignore_patterns("worker.lock", f"{LIBRARY_DB.name}*", *SKIP_STORAGE)
        shutil.copytree(STORAGE_DIR, stage / "storage", ignore=ignore)
        db_copy = stage / "storage" / LIBRARY_DB.name
        with sqlite3.connect(LIBRARY_DB) as source, sqlite3.connect(db_copy) as dest:
            source.backup(dest)
        shutil.copytree(VECTOR_DB_DIR, stage / "vector_db")
        shutil.copytree(DATA_DIR, stage / "data")
        if plan:
            apply_exclusion(stage, db_copy, plan)
        with sqlite3.connect(db_copy) as db:
            for part_id, name in renames.items():
                db.execute("UPDATE parts SET name = ? WHERE part_id = ?", (name, part_id))
        # 지운 행이 빈 페이지에 남지 않게 파일을 다시 쓴다 (공개 서버에 올라가는 사본).
        vacuum = sqlite3.connect(db_copy)
        vacuum.execute("VACUUM")
        vacuum.close()
        restored = restore_missing_origin(stage, db_copy)
        summary = {"source": manifest(), "excluded_parts": args.exclude_part, "renamed_parts": renames, "restored_origin_files": restored}
        (stage / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        with connect_ro(db_copy) as db:
            print("\n사본 기준:")
            print_parts(part_report(db))
        with tarfile.open(target, "w:gz") as tar:
            for name in ("storage", "vector_db", "data", "manifest.json"):
                tar.add(stage / name, arcname=name)

    print(f"\n데이터 사본: {target} ({target.stat().st_size / 1_048_576:.1f} MB)")
    print(f"OCR 작업 폴더에서 채운 검수 원본 파일: {restored}개")
    print("이 파일을 노트북에 보관하세요. 서버 디스크의 백업은 서버를 지우면 함께 사라집니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
