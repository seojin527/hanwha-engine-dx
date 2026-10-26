"""로컬 DB(SQLite·Chroma) 백업과 건수·ID 비교.

실행 (backend 폴더에서):
    python tools/backup_local_data.py --manifest              # 현재 데이터 요약만 출력 (읽기 전용)
    python tools/backup_local_data.py --backup                # 서버를 멈춘 상태에서 storage/·vector_db/ 백업
    python tools/backup_local_data.py --verify <백업 폴더>     # 현재 데이터와 백업의 건수·ID 비교

- 백업은 실행 중인 DB 를 복사하지 않도록 127.0.0.1:8000 서버가 떠 있으면 거부한다.
- 백업 위치: <저장소>/backups/local-data-<시각>/ (Git 공유 안 함)
- 복구는 자동으로 하지 않는다. README 의 '백업·복구' 절차를 따른다.
- 원문 내용은 출력하지 않고 건수와 ID 해시만 기록한다.
"""

import argparse
import hashlib
import json
import shutil
import socket
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import LIBRARY_DB, REPO_ROOT, STORAGE_DIR, VECTOR_DB_DIR  # noqa: E402

BACKUP_ROOT = REPO_ROOT / "backups"


def server_running(host="127.0.0.1", port=8000) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def _id_digest(ids) -> str:
    return hashlib.sha256("\n".join(sorted(ids)).encode("utf-8")).hexdigest()[:16]


def manifest(storage_dir: Path = STORAGE_DIR, vector_dir: Path = VECTOR_DB_DIR) -> dict:
    """테이블별 건수, 오류 원문 테이블의 case_id 해시, 컬렉션별 건수·ID 해시, 파일 수 (읽기 전용)."""
    result = {"sqlite": {}, "case_ids": {}, "chroma": {}, "files": {}}
    db_path = storage_dir / LIBRARY_DB.name
    if db_path.is_file():
        db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        try:
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            for table in tables:
                result["sqlite"][table] = db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                if table.endswith("error_cases"):
                    result["case_ids"][table] = _id_digest(row[0] for row in db.execute(f'SELECT case_id FROM "{table}"'))
        finally:
            db.close()
    if vector_dir.is_dir():
        import chromadb

        client = chromadb.PersistentClient(path=str(vector_dir))
        for collection in client.list_collections():
            ids = client.get_collection(collection.name).get(include=[])["ids"]
            result["chroma"][collection.name] = {"count": len(ids), "ids": _id_digest(ids)}
    for name in ("uploads", "ocr_results", "ocr_jobs"):
        folder = storage_dir / name
        result["files"][name] = sum(1 for path in folder.rglob("*") if path.is_file()) if folder.is_dir() else 0
    return result


def backup() -> Path:
    if server_running():
        raise SystemExit("서버(127.0.0.1:8000)가 실행 중입니다. 서버를 멈춘 뒤 다시 실행하세요. 실행 중인 DB 폴더는 복사하지 않습니다.")
    target = BACKUP_ROOT / time.strftime("local-data-%Y%m%d-%H%M%S")
    target.mkdir(parents=True)
    before = manifest()
    shutil.copytree(STORAGE_DIR, target / "storage")
    shutil.copytree(VECTOR_DB_DIR, target / "vector_db")
    copied = manifest(target / "storage", target / "vector_db")
    (target / "manifest.json").write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding="utf-8")
    if copied != before:
        raise SystemExit(f"백업본의 건수·ID 가 원본과 다릅니다. 백업 폴더를 확인하세요: {target}")
    print(f"백업 완료: {target}")
    return target


def compare(current: dict, saved: dict) -> list[str]:
    differences = []
    for section in ("sqlite", "case_ids", "chroma", "files"):
        keys = set(current.get(section, {})) | set(saved.get(section, {}))
        for key in sorted(keys):
            now, then = current.get(section, {}).get(key), saved.get(section, {}).get(key)
            if now != then:
                differences.append(f"{section}.{key}: 백업 {then} → 현재 {now}")
    return differences


def main(argv=None):
    parser = argparse.ArgumentParser(description="로컬 DB 백업·비교")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--manifest", action="store_true", help="현재 데이터 요약 출력")
    action.add_argument("--backup", action="store_true", help="storage/·vector_db/ 백업 (서버 정지 필요)")
    action.add_argument("--verify", metavar="BACKUP_DIR", help="현재 데이터와 백업 비교")
    args = parser.parse_args(argv)

    if args.manifest:
        print(json.dumps(manifest(), ensure_ascii=False, indent=2))
    elif args.backup:
        backup()
    else:
        saved = json.loads((Path(args.verify) / "manifest.json").read_text(encoding="utf-8"))
        differences = compare(manifest(), saved)
        print("\n".join(differences) if differences else "백업과 현재 데이터의 건수·ID 가 같습니다.")
        return 1 if differences else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
