"""오류사례 DB를 지정한 엑셀들로 새로 구성한다. (기존 오류사례는 백업 후 교체)

실행 전 백엔드 서버를 꺼야 한다.
  python rebuild_error_cases.py --file a.xlsx --file b.xlsx --file c.xlsx

하는 일
  1. backend/vector_db 와 storage/library.sqlite3 를 백업한다 (원본은 그대로 남는 복사본).
  2. 엑셀로 등록된 기존 사례(SQLite error_cases, Chroma)를 지운다.
     화면에서 직접 등록한 사례(case_id 가 USR- 로 시작)는 지우지 않는다.
  3. 지정한 엑셀들을 ingest_errors.ingest_excel 로 다시 등록한다.
  4. 최종 건수를 출력한다.
기존 ingest_errors.py 는 수정하지 않고 가져다 쓴다.
"""

import argparse
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import chromadb

import ingest_errors
from drawing_library import database

BASE_DIR = Path(__file__).resolve().parent
VECTOR_DIR = ingest_errors.DB_PATH
COLLECTION = ingest_errors.COLLECTION_NAME
KEEP_PREFIX = "USR-"  # 화면에서 직접 등록한 사례


def sqlite_path() -> Path:
    with database() as db:
        row = db.execute("PRAGMA database_list").fetchone()
    return Path(row[2])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", action="append", required=True, help="등록할 오류사례 엑셀 (여러 번 지정)")
    args = parser.parse_args()

    files = [Path(f).resolve() for f in args.file]
    for f in files:
        if not f.exists():
            raise SystemExit(f"파일이 없습니다: {f}")

    ingest_errors.init_library()
    ingest_errors.init_error_cases()

    with database() as db:
        total = db.execute("SELECT COUNT(*) FROM error_cases").fetchone()[0]
        keep = db.execute(
            "SELECT COUNT(*) FROM error_cases WHERE case_id LIKE ?", (KEEP_PREFIX + "%",)
        ).fetchone()[0]
    print(f"현재 SQLite 오류사례: {total}건 (화면 등록 {KEEP_PREFIX}* {keep}건은 유지)")
    print(f"삭제 대상: {total - keep}건")
    print("새로 등록할 엑셀:")
    for f in files:
        print(f"  - {f.name}")
    if input("백업 후 진행하려면 yes 를 입력하세요: ").strip().lower() != "yes":
        raise SystemExit("취소했습니다. 아무것도 바꾸지 않았습니다.")

    # 1) 백업
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db_file = sqlite_path()
    sqlite_backup = db_file.with_name(f"{db_file.name}.bak_{stamp}")
    vector_backup = VECTOR_DIR.with_name(f"{VECTOR_DIR.name}_backup_{stamp}")
    shutil.copy2(db_file, sqlite_backup)
    if VECTOR_DIR.exists():
        shutil.copytree(VECTOR_DIR, vector_backup)
    print(f"백업 완료: {sqlite_backup.name}, {vector_backup.name}")

    # 2) 기존 사례 삭제 (화면 등록분 제외)
    with database() as db:
        try:
            db.execute("DELETE FROM error_cases WHERE case_id NOT LIKE ?", (KEEP_PREFIX + "%",))
        except sqlite3.IntegrityError as error:
            raise SystemExit(
                f"삭제할 수 없습니다(다른 기록이 참조 중): {error}\n"
                f"아무것도 바뀌지 않았습니다. 백업은 {sqlite_backup.name} 입니다."
            )

    client = chromadb.PersistentClient(path=str(VECTOR_DIR))
    try:
        collection = client.get_collection(name=COLLECTION, embedding_function=None)
        ids = [i for i in collection.get(include=[])["ids"] if not i.startswith(KEEP_PREFIX)]
        for start in range(0, len(ids), 500):
            collection.delete(ids=ids[start:start + 500])
        print(f"Chroma 기존 사례 삭제: {len(ids)}건")
    except Exception as error:  # 컬렉션이 없으면 새로 만들어진다
        print(f"Chroma 컬렉션을 비우지 못했습니다(새로 만들어집니다): {error}")

    # 3) 새로 등록
    for f in files:
        print(f"\n== {f.name}")
        ingest_errors.ingest_excel(f)

    # 4) 결과
    client = chromadb.PersistentClient(path=str(VECTOR_DIR))
    count = client.get_collection(name=COLLECTION, embedding_function=None).count()
    with database() as db:
        sqlite_count = db.execute("SELECT COUNT(*) FROM error_cases").fetchone()[0]
    print(f"\n최종: SQLite {sqlite_count}건, Chroma {count}건 (화면 등록 {KEEP_PREFIX}* {keep}건 포함)")


if __name__ == "__main__":
    main()
