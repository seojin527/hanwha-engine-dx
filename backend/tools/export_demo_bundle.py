"""발표 서버에 올릴 데이터 사본(tar.gz) 만들기. 원본 데이터는 바꾸지 않는다.

실행 (backend 폴더에서, 서버를 멈춘 상태):
    .venv\\Scripts\\python.exe tools\\export_demo_bundle.py

- 담는 것: storage/(검증용 하위 폴더 제외) · vector_db/ · data/  →  ..\\backups\\demo-bundle-<시각>.tar.gz
- 서버의 deploy/restore.sh 가 같은 구조(storage/ vector_db/ data/)를 그대로 풀어 쓴다.
- 부품별 도면 수와 3D 유형 연결 상태를 출력한다. 연결은 자동으로 하지 않는다 (관리자 주소에서 직접 연결).
"""

import io
import json
import sqlite3
import sys
import tarfile
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import DATA_DIR, LIBRARY_DB, OCR_JOB_DIR, ORIGIN_DIR, STORAGE_DIR, VECTOR_DB_DIR  # noqa: E402
from tools.backup_local_data import BACKUP_ROOT, manifest, server_running  # noqa: E402

# 로컬 환경 검증 때 만든 DB 사본들. 발표 서버에는 필요 없다.
SKIP_STORAGE = {"environment-verification", "ui-verification"}


def _skip(path: Path) -> bool:
    return path.name == "worker.lock" or path.name in SKIP_STORAGE


def part_report(db_path: Path) -> list[dict]:
    db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        columns = {row[1] for row in db.execute("PRAGMA table_info(parts)")}
        key = "p.engine_part_key" if "engine_part_key" in columns else "NULL"
        rows = db.execute(
            f"""SELECT p.part_id, p.name, {key}, COUNT(d.drawing_id),
                       COALESCE(SUM(d.drawing_id IN (SELECT drawing_id FROM ocr_results)), 0)
                FROM parts p LEFT JOIN drawings d ON d.part_id = p.part_id
                GROUP BY p.part_id ORDER BY p.name"""
        ).fetchall()
    finally:
        db.close()
    return [
        {"part_id": r[0], "name": r[1], "engine_part_key": r[2], "drawings": r[3], "with_ocr": r[4]}
        for r in rows
    ]


def missing_origin_files(db_path: Path) -> list[tuple[Path, str]]:
    """data/origin 에 <도면ID>_origin.txt·_result.jpg 가 없는 OCR 완료 도면은 마지막 완료 작업 폴더의 파일을 쓴다.

    (자동 OCR 이 data/origin 으로 복사하기 전에 처리된 도면들. 원본 폴더는 바꾸지 않고 사본에만 넣는다.)
    """
    db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        rows = db.execute(
            """SELECT j.drawing_id, j.job_id, d.stored_filename FROM ocr_jobs j JOIN drawings d USING (drawing_id)
               WHERE j.status = 'completed' AND j.drawing_id IN (SELECT drawing_id FROM ocr_results)
               ORDER BY j.rowid"""
        ).fetchall()
    finally:
        db.close()
    latest = {drawing_id: (job_id, Path(stored).stem) for drawing_id, job_id, stored in rows}
    found = []
    for drawing_id, (job_id, stem) in latest.items():
        for suffix in ("_origin.txt", "_result.jpg"):
            source = OCR_JOB_DIR / job_id / f"{stem}{suffix}"
            if not (ORIGIN_DIR / f"{drawing_id}{suffix}").is_file() and source.is_file():
                found.append((source, f"data/origin/{drawing_id}{suffix}"))
    return found


def main() -> int:
    if server_running():
        raise SystemExit("서버(127.0.0.1:8000)가 실행 중입니다. 멈춘 뒤 다시 실행하세요.")
    if not LIBRARY_DB.is_file():
        raise SystemExit(f"DB 가 없습니다: {LIBRARY_DB}")
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    target = BACKUP_ROOT / time.strftime("demo-bundle-%Y%m%d-%H%M%S.tar.gz")

    with tempfile.TemporaryDirectory() as tmp:
        # 실행 중이 아니어도 SQLite 는 backup API 로 일관된 사본을 만든다.
        db_copy = Path(tmp) / LIBRARY_DB.name
        with sqlite3.connect(LIBRARY_DB) as source, sqlite3.connect(db_copy) as dest:
            source.backup(dest)
        with tarfile.open(target, "w:gz") as tar:
            for child in sorted(STORAGE_DIR.iterdir()):
                if _skip(child) or child.name.startswith(LIBRARY_DB.name):  # -wal·-shm 포함, 아래에서 사본으로 넣는다
                    continue
                tar.add(child, arcname=f"storage/{child.name}", filter=lambda info: None if Path(info.name).name == "worker.lock" else info)
            tar.add(db_copy, arcname=f"storage/{LIBRARY_DB.name}")
            tar.add(VECTOR_DB_DIR, arcname="vector_db")
            tar.add(DATA_DIR, arcname="data")
            restored = missing_origin_files(LIBRARY_DB)
            for source, arcname in restored:
                tar.add(source, arcname=arcname)
            info = json.dumps(manifest(), ensure_ascii=False, indent=2).encode("utf-8")
            entry = tarfile.TarInfo("manifest.json")
            entry.size = len(info)
            entry.mtime = int(time.time())
            tar.addfile(entry, io.BytesIO(info))

    print(f"데이터 사본: {target} ({target.stat().st_size / 1_048_576:.1f} MB)")
    print(f"OCR 작업 폴더에서 채운 검수 원본 파일: {len(restored)}개 (data/origin, 사본에만)")
    print("\n부품별 도면 · 3D 연결 상태 (연결은 관리자 주소의 화면에서 직접 지정):")
    for row in part_report(LIBRARY_DB):
        link = row["engine_part_key"] or "미연결"
        print(f"  - {row['name']}: 도면 {row['drawings']}건 (OCR 결과 {row['with_ocr']}건), 3D={link}, id={row['part_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
