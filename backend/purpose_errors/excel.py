"""목적별 오류사례 엑셀 검증 · 반영 계획 · 반영 · 내보내기.

명령줄 적재(ingest.py)와 관리자 화면(admin_api.py)이 이 파일 하나를 함께 쓴다 (검증 규칙을 따로 두지 않는다).
행 단위 값 규칙은 목적별 스키마(schemas/<목적>.py 의 excel_record)에 있다.

규칙
- 모든 파일을 먼저 검사한다. 하나라도 문제가 있으면 사례 원문을 하나도 저장하지 않는다.
- 같은 목적의 기존 case_id 는 엑셀 행 내용으로 갱신하고, 내용이 같으면 건드리지 않는다.
- 파일에 없는 기존 사례는 그대로 둔다. 다른 목적의 저장소는 읽지도 쓰지도 않는다.
- 활성 상태는 업로드로 바뀌지 않는다. 새 사례는 활성, 기존 사례는 지금 상태를 유지한다.
  내보낸 파일의 active·vector_status·created_at·updated_at 열은 참고용이며 업로드 때 읽지 않는다.
- 원문 저장 뒤 벡터 반영에 실패하면 원문은 남기고 vector_status='failed' 로 둔다.
  다시 올리거나 재시도하면 같은 case_id 로 덮어쓰므로(upsert) 벡터가 중복되지 않는다.
"""

import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import pandas as pd

from drawing_library import database

from . import store as case_store
from . import vectors
from .purposes import PurposeStore

DEFAULT_SHEET = "오류주의사항DB"
REQUIRED_COLUMNS = ("case_id", "case_title", "search_text")
INFO_COLUMNS = ("active", "vector_status", "created_at", "updated_at")
CASE_ID_MAX = 100


class ExcelValidationError(ValueError):
    """검증 실패. errors 는 [{file, sheet, row, case_id, message}] (row 는 엑셀 행 번호, 머리글이 1행)."""

    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__("\n".join(format_error(error) for error in errors))


def format_error(error: dict) -> str:
    where = [error.get("file") or "", error.get("sheet") or ""]
    if error.get("row"):
        where.append(f"{error['row']}행")
    if error.get("case_id"):
        where.append(error["case_id"])
    return " · ".join(part for part in where if part) + f": {error['message']}"


@dataclass
class ExcelFile:
    name: str
    sheet: str
    records: list[dict] = field(default_factory=list)
    rows: list[int] = field(default_factory=list)


def _error(name, sheet, message, row=None, case_id=""):
    return {"file": name, "sheet": sheet, "row": row, "case_id": case_id, "message": message}


def read_file(store: PurposeStore, name: str, source, sheet: str = DEFAULT_SHEET) -> tuple[ExcelFile | None, list[dict]]:
    """엑셀 하나를 읽어 레코드로 바꾼다. source 는 경로 또는 bytes."""
    try:
        frame = pd.read_excel(
            io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source,
            sheet_name=sheet, dtype=str, keep_default_na=False,
        )
    except ValueError as error:
        if "Worksheet" in str(error) or "sheet" in str(error).lower():
            return None, [_error(name, sheet, f"'{sheet}' 시트가 없습니다.")]
        return None, [_error(name, sheet, "엑셀 파일을 읽을 수 없습니다 (.xlsx 형식인지 확인해주세요).")]
    except Exception:
        return None, [_error(name, sheet, "엑셀 파일을 읽을 수 없습니다 (.xlsx 형식인지 확인해주세요).")]

    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        return None, [_error(name, sheet, f"필수 컬럼 누락: {missing}")]
    if frame.empty:
        return None, [_error(name, sheet, "등록할 오류사례가 없습니다.")]

    result, errors, first_row = ExcelFile(name, sheet), [], {}
    for index, row in enumerate(frame.to_dict(orient="records")):
        row_number = index + 2  # 1행은 머리글
        raw_id = str(row.get("case_id", "") or "").strip()
        try:
            record = store.schema.excel_record(row)
        except ValueError as error:
            errors.append(_error(name, sheet, str(error), row_number, raw_id))
            continue
        case_id = record["case_id"]
        if len(case_id) > CASE_ID_MAX or any(ch.isspace() for ch in case_id):
            errors.append(_error(name, sheet, "case_id 는 공백 없이 100자 이하여야 합니다.", row_number, case_id))
            continue
        if case_id in first_row:
            errors.append(_error(name, sheet, f"엑셀에 중복 case_id가 있습니다 ({first_row[case_id]}행과 같음).", row_number, case_id))
            continue
        first_row[case_id] = row_number
        result.records.append(record)
        result.rows.append(row_number)
    return result, errors


def validate_files(store: PurposeStore, sources: list[tuple[str, object]], sheet: str = DEFAULT_SHEET) -> list[ExcelFile]:
    """여러 파일을 모두 검사한다. 문제가 하나라도 있으면 ExcelValidationError (아무것도 저장하지 않음)."""
    if not sources:
        raise ValueError("적재할 엑셀 파일이 없습니다.")
    files, errors, seen = [], [], {}
    for name, source in sources:
        excel, file_errors = read_file(store, name, source, sheet)
        errors.extend(file_errors)
        if excel is None:
            continue
        for record, row in zip(excel.records, excel.rows):
            case_id = record["case_id"]
            if case_id in seen and seen[case_id][0] != name:
                errors.append(_error(
                    name, sheet,
                    f"case_id {case_id} 가 {seen[case_id][0]} ({seen[case_id][1]}행) 와 {name} 에 모두 있습니다.",
                    row, case_id,
                ))
            seen.setdefault(case_id, (name, row))
        files.append(excel)
    names = [name for name, _ in sources]
    if len(names) != len(set(names)):
        errors.append(_error("", sheet, "같은 이름의 파일을 두 번 선택했습니다."))
    if errors:
        raise ExcelValidationError(errors)
    return files


def _existing(db, store: PurposeStore, case_ids: list[str]) -> dict[str, dict]:
    found = {}
    for start in range(0, len(case_ids), 500):
        chunk = case_ids[start:start + 500]
        placeholders = ", ".join("?" for _ in chunk)
        for row in db.execute(f"SELECT * FROM {store.case_table} WHERE case_id IN ({placeholders})", chunk):
            found[row["case_id"]] = dict(row)
    return found


def plan_changes(db, store: PurposeStore, files: list[ExcelFile]) -> dict:
    """사례별 신규·갱신·변경 없음. 저장하지 않는다."""
    existing = _existing(db, store, [record["case_id"] for excel in files for record in excel.records])
    fields = store.schema.RECORD_FIELDS
    summary = {"rows": 0, "created": 0, "updated": 0, "unchanged": 0, "files": [], "changes": []}
    for excel in files:
        counts = {"created": 0, "updated": 0, "unchanged": 0}
        for record, row in zip(excel.records, excel.rows):
            current = existing.get(record["case_id"])
            if current is None:
                action, changed = "created", []
            else:
                changed = [name for name in fields if str(current.get(name) or "") != record[name]]
                action = "updated" if changed else "unchanged"
            counts[action] += 1
            summary["changes"].append({
                "file": excel.name, "row": row, "case_id": record["case_id"],
                "case_title": record["case_title"], "action": action, "changed_fields": changed,
                "active": None if current is None else bool(current.get("active", 1)),
                "vector_status": None if current is None else current.get("vector_status"),
            })
        summary["files"].append({"file": excel.name, "sheet": excel.sheet, "rows": len(excel.records), **counts})
        summary["rows"] += len(excel.records)
        for key, value in counts.items():
            summary[key] += value
    return summary


def preview(store: PurposeStore, files: list[ExcelFile]) -> dict:
    with database() as db:
        return plan_changes(db, store, files)


def apply(store: PurposeStore, files: list[ExcelFile], *, model, collection, source: str) -> dict:
    """검증된 파일을 반영한다. 원문 저장과 벡터 반영 결과를 따로 돌려준다."""
    upload_id = f"UPL-{uuid4().hex}"
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        # 미리보기 뒤에 바뀌었을 수 있으므로 저장 직전 상태로 다시 계산한다.
        plan = plan_changes(db, store, files)
        by_id = {record["case_id"]: record for excel in files for record in excel.records}
        for change in plan["changes"]:
            record = by_id[change["case_id"]]
            if change["action"] == "created":
                case_store.insert_case(db, store, record)
                case_store.add_history(db, store, record["case_id"], "create", upload_id=upload_id,
                                       detail={"via": "excel", "file": change["file"], "row": change["row"]})
            elif change["action"] == "updated":
                case_store.update_case_fields(db, store, record["case_id"], record)
                case_store.add_history(db, store, record["case_id"], "update", upload_id=upload_id,
                                       detail={"via": "excel", "file": change["file"], "row": change["row"],
                                               "fields": change["changed_fields"]})
        db.execute(
            """
            INSERT INTO error_case_uploads
                (upload_id, purpose, source, status, file_count, row_count,
                 created_count, updated_count, unchanged_count, vector_status)
            VALUES (?, ?, ?, 'applied', ?, ?, ?, ?, ?, 'pending')
            """,
            (upload_id, store.purpose.value, source, len(files), plan["rows"],
             plan["created"], plan["updated"], plan["unchanged"]),
        )
        for index, entry in enumerate(plan["files"]):
            db.execute(
                """
                INSERT INTO error_case_upload_files
                    (upload_id, file_index, file_name, sheet, row_count, created_count, updated_count, unchanged_count, vector_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                """,
                (upload_id, index, entry["file"], entry["sheet"], entry["rows"],
                 entry["created"], entry["updated"], entry["unchanged"]),
            )
        # 변경 없는 사례도 벡터가 아직 반영되지 않았으면 이번에 다시 반영한다.
        not_ready = {
            change["case_id"] for change in plan["changes"]
            if change["action"] != "unchanged" or change["vector_status"] != "ready"
        }

    # 벡터 반영 (파일별 source_file 을 메타데이터에 남긴다)
    file_results, ready, failed = [], 0, 0
    for index, excel in enumerate(files):
        ids = [record["case_id"] for record in excel.records if record["case_id"] in not_ready]
        status = vectors.index_cases(store, collection, model, ids, source_file=excel.name) if ids else "none"
        if status == "ready":
            ready += len(ids)
        elif status == "failed":
            failed += len(ids)
        file_results.append({**plan["files"][index], "indexed": len(ids), "vector_status": status})
        with database() as db:
            db.execute("UPDATE error_case_upload_files SET vector_status=? WHERE upload_id=? AND file_index=?",
                       (status, upload_id, index))

    overall = "failed" if failed else ("ready" if ready else "none")
    with database() as db:
        db.execute(
            "UPDATE error_case_uploads SET vector_status=?, vector_ready=?, vector_failed=? WHERE upload_id=?",
            (overall, ready, failed, upload_id),
        )
    return {
        "upload_id": upload_id,
        "purpose": store.purpose.value,
        "saved": True,
        "rows": plan["rows"],
        "created": plan["created"],
        "updated": plan["updated"],
        "unchanged": plan["unchanged"],
        "vector_status": overall,
        "vector_ready": ready,
        "vector_failed": failed,
        "files": file_results,
    }


def record_rejected(store: PurposeStore, names: list[str], errors: list[dict], *, source: str, sheet: str = DEFAULT_SHEET) -> str:
    """반영 요청이 검증에서 거부된 기록 (사례 원문은 저장하지 않는다)."""
    upload_id = f"UPL-{uuid4().hex}"
    with database() as db:
        db.execute(
            """
            INSERT INTO error_case_uploads (upload_id, purpose, source, status, file_count, errors_json)
            VALUES (?, ?, ?, 'rejected', ?, ?)
            """,
            (upload_id, store.purpose.value, source, len(names), json.dumps(errors[:200], ensure_ascii=False)),
        )
        for index, name in enumerate(names):
            db.execute(
                "INSERT INTO error_case_upload_files (upload_id, file_index, file_name, sheet) VALUES (?, ?, ?, ?)",
                (upload_id, index, Path(name).name, sheet),
            )
    return upload_id


def export_bytes(store: PurposeStore) -> bytes:
    """선택 목적의 사례 전체. 같은 형식으로 다시 올릴 수 있다 (참고 열은 업로드 때 무시)."""
    fields = store.schema.RECORD_FIELDS
    with database() as db:
        rows = [dict(row) for row in db.execute(
            f"SELECT {', '.join(fields)}, {', '.join(INFO_COLUMNS)} FROM {store.case_table} ORDER BY case_id"
        )]
    for row in rows:
        row["active"] = "Y" if row["active"] else "N"
        row["created_at"] = case_store.local_time(row["created_at"])
        row["updated_at"] = case_store.local_time(row["updated_at"])
    frame = pd.DataFrame(rows, columns=[*fields, *INFO_COLUMNS])
    guide = pd.DataFrame({
        "항목": ["목적", "시트", "필수 열", "참고 열", "활성 상태", "갱신"],
        "설명": [
            f"{store.label} ({store.purpose.value}) 오류사례만 들어 있습니다. 같은 목적으로만 다시 올려주세요.",
            f"'{DEFAULT_SHEET}' 시트를 읽습니다.",
            ", ".join(REQUIRED_COLUMNS),
            ", ".join(INFO_COLUMNS) + " 열은 참고용이며 업로드 때 읽지 않습니다.",
            "업로드는 활성·비활성 상태를 바꾸지 않습니다. 관리자 화면에서 바꿔주세요.",
            "같은 case_id 는 행 내용으로 갱신하고, 파일에 없는 사례는 그대로 둡니다.",
        ],
    })
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name=DEFAULT_SHEET, index=False)
        guide.to_excel(writer, sheet_name="안내", index=False)
    return buffer.getvalue()
