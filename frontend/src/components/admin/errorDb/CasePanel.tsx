/**
 * 오류 DB 사례 목록 · 검색 · 상세 · 개별 등록·수정 · 비활성화·재활성화 · 벡터 재시도.
 * 폼 항목은 서버의 목적별 스키마(/schema)를 그대로 쓴다. 목적마다 스키마 파일만 고치면 폼·엑셀 열이 함께 바뀐다.
 */
import { useEffect, useMemo, useState } from "react";
import { MapPin, Plus, RotateCw, Search } from "lucide-react";
import type { WorkPurpose } from "../../../lib/purpose";
import { useReportUnsaved } from "../../../lib/unsavedChanges";
import {
  ACTION_LABEL,
  VECTOR_LABEL,
  createCase,
  fetchCaseDetail,
  fetchCases,
  retryVectors,
  setCaseActive,
  updateCase,
  type CaseDetail,
  type CaseRow,
  type PurposeSchema,
  type VectorStatus,
} from "../../../lib/admin/errorDbAPI";
import { Empty, ErrorNote, Loading, Tag, type LocationTarget } from "../adminUi";

const PAGE = 50;

export function vectorTag(status: VectorStatus) {
  return <Tag tone={status === "ready" ? "ok" : status === "failed" ? "bad" : "warn"}>{VECTOR_LABEL[status]}</Tag>;
}

export function activeTag(active: boolean | null | undefined) {
  if (active === null || active === undefined) return null;
  return active ? <Tag tone="ok">활성</Tag> : <Tag tone="muted">비활성</Tag>;
}

export function CasePanel({
  purpose,
  schema,
  mode,
  refreshKey,
  onChanged,
  onOpenLocation,
}: {
  purpose: WorkPurpose;
  schema: PurposeSchema | null;
  /** cases: 전체 사례 · vector: 벡터 반영 상태 중심 (들어올 때마다 상태 필터는 '전체') */
  mode: "cases" | "vector";
  refreshKey: number;
  onChanged: () => void;
  onOpenLocation: (target: LocationTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [active, setActive] = useState<"all" | "active" | "inactive">("all");
  const [vector, setVector] = useState<"all" | VectorStatus>("all");
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<{ total: number; items: CaseRow[] } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // 카드를 바꿔 들어오면 반영 완료·실패·대기를 모두 보이도록 필터를 초기화한다.
    setVector("all");
    setOffset(0);
  }, [mode]);

  useEffect(() => {
    setSelected(null);
    setEditing(null);
    setOffset(0);
    setNotice("");
  }, [purpose]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetchCases(purpose, { q: appliedQuery, active, vector, limit: PAGE, offset }, controller.signal)
      .then((data) => !controller.signal.aborted && setList(data))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "사례 조회 실패");
      });
    return () => controller.abort();
  }, [purpose, appliedQuery, active, vector, offset, reload, refreshKey]);

  function changed(message = "") {
    setNotice(message);
    setReload((v) => v + 1);
    onChanged();
  }

  async function retryAll() {
    setBusy("retry");
    setNotice("");
    try {
      const result = await retryVectors(purpose);
      changed(`재시도 ${result.requested}건 · 반영 ${result.ready}건 · 실패 ${result.failed}건`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재시도 실패");
    } finally {
      setBusy("");
    }
  }

  const pageInfo = list ? `${list.total ? offset + 1 : 0}–${Math.min(offset + PAGE, list.total)} / ${list.total}건` : "";

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      <section aria-label="사례 목록" className="card flex min-h-[320px] flex-col overflow-hidden">
        <header className="card-header flex-wrap">
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setAppliedQuery(query.trim());
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">사례 검색</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="사례 ID · 제목 · 내용 · 부품 · 키워드"
                className="field pl-7"
              />
            </label>
            <button type="submit" className="btn btn-secondary">검색</button>
          </form>
          <select aria-label="활성 상태" value={active} onChange={(e) => { setOffset(0); setActive(e.target.value as typeof active); }} className="field w-auto">
            <option value="all">활성·비활성 전체</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
          </select>
          <select aria-label="벡터 반영 상태" value={vector} onChange={(e) => { setOffset(0); setVector(e.target.value as typeof vector); }} className="field w-auto">
            <option value="all">벡터 상태 전체</option>
            <option value="ready">반영 완료</option>
            <option value="failed">반영 실패</option>
            <option value="pending">반영 대기</option>
          </select>
          {mode === "vector" ? (
            <button type="button" disabled={busy === "retry"} onClick={() => void retryAll()} className="btn btn-primary">
              <RotateCw aria-hidden="true" className={`h-3.5 w-3.5 ${busy === "retry" ? "animate-spin" : ""}`} />
              실패·대기 전체 재시도
            </button>
          ) : (
            <button type="button" disabled={!schema} onClick={() => { setSelected(null); setEditing("new"); }} className="btn btn-primary">
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              사례 등록
            </button>
          )}
        </header>

        {notice && <p role="status" className="note note-ok m-2">{notice}</p>}
        <div className="px-2"><ErrorNote message={error} /></div>

        <div className="min-h-0 flex-1 overflow-auto">
          {!list ? (
            <Loading>사례를 불러오는 중…</Loading>
          ) : list.items.length === 0 ? (
            <Empty>조건에 맞는 사례가 없습니다.</Empty>
          ) : (
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#2e2e2e] text-[11px] text-neutral-400">
                <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                  <th scope="col" className="w-40">사례 ID</th>
                  <th scope="col">주요 내용</th>
                  <th scope="col" className="w-20">목적</th>
                  <th scope="col" className="w-16">상태</th>
                  <th scope="col" className="w-20">벡터</th>
                  <th scope="col" className="w-14 text-right">연결</th>
                  <th scope="col" className="w-36">등록 · 수정</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((row) => {
                  const on = row.case_id === selected;
                  return (
                    <tr
                      key={row.case_id}
                      tabIndex={0}
                      aria-selected={on}
                      onClick={() => { setSelected(row.case_id); setEditing(null); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(row.case_id);
                          setEditing(null);
                        }
                      }}
                      className={`cursor-pointer outline-none [&>td]:border-b [&>td]:border-neutral-700 [&>td]:px-3 [&>td]:py-2 [&>td]:align-top focus-visible:[&>td]:bg-neutral-700 ${
                        on ? "[&>td]:bg-cyan-400/10 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-cyan-400)]" : "hover:[&>td]:bg-white/5"
                      }`}
                    >
                      <td className="break-all font-mono text-[11px] text-neutral-300">{row.case_id}</td>
                      <td>
                        <span className={`block ${row.active ? "text-neutral-100" : "text-neutral-400 line-through decoration-neutral-600"}`}>{row.case_title}</span>
                        <span className="mt-0.5 line-clamp-1 text-[11px] text-neutral-400">
                          {[row.part_family, row.feature_type, row.error_description].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="text-neutral-300">{schema?.label ?? purpose}</td>
                      <td>{activeTag(row.active)}</td>
                      <td>{vectorTag(row.vector_status)}</td>
                      <td className="text-right tabular-nums text-neutral-300">{row.link_count}</td>
                      <td className="whitespace-nowrap text-[11px] tabular-nums text-neutral-400">
                        {row.created_at}
                        <br />
                        {row.updated_at}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {list && list.total > PAGE && (
          <footer className="flex items-center justify-end gap-2 border-t border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-400">
            <span className="tabular-nums">{pageInfo}</span>
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="btn btn-secondary">이전</button>
            <button type="button" disabled={offset + PAGE >= list.total} onClick={() => setOffset(offset + PAGE)} className="btn btn-secondary">다음</button>
          </footer>
        )}
      </section>

      <section aria-label="사례 상세" className="card flex min-h-[320px] flex-col overflow-hidden">
        {editing && schema ? (
          <CaseForm
            key={`${purpose}:${editing}:${selected ?? ""}`}
            purpose={purpose}
            schema={schema}
            caseId={editing === "edit" ? selected : null}
            onCancel={() => setEditing(null)}
            onSaved={(caseId, message) => {
              setEditing(null);
              setSelected(caseId);
              changed(message);
            }}
          />
        ) : selected ? (
          <CaseDetailView
            key={`${purpose}:${selected}:${reload}`}
            purpose={purpose}
            schema={schema}
            caseId={selected}
            onEdit={() => setEditing("edit")}
            onChanged={changed}
            onOpenLocation={onOpenLocation}
          />
        ) : (
          <Empty>목록에서 사례를 선택하면 상세 내용·연결·이력을 볼 수 있습니다.</Empty>
        )}
      </section>
    </div>
  );
}

function CaseDetailView({
  purpose,
  schema,
  caseId,
  onEdit,
  onChanged,
  onOpenLocation,
}: {
  purpose: WorkPurpose;
  schema: PurposeSchema | null;
  caseId: string;
  onEdit: () => void;
  onChanged: (message?: string) => void;
  onOpenLocation: (target: LocationTarget) => void;
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCaseDetail(purpose, caseId, controller.signal)
      .then((data) => !controller.signal.aborted && setDetail(data))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "상세 조회 실패");
      });
    return () => controller.abort();
  }, [purpose, caseId]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      onChanged(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "처리 실패");
      setBusy(false);
    }
  }

  if (!detail) return error ? <div className="p-3"><ErrorNote message={error} /></div> : <Loading />;
  const row = detail.case;
  const linked = detail.links.filter((link) => link.linked);

  return (
    <>
      <header className="card-header">
        <h3 className="min-w-0 truncate text-xs font-semibold text-white">{row.case_title}</h3>
        <span className="flex shrink-0 gap-1">{activeTag(row.active)}{vectorTag(row.vector_status)}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={onEdit} className="btn btn-secondary">수정</button>
          {row.active ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("이 사례를 비활성화할까요? 삭제하지 않으며, 신규 검색·연결에서만 빠집니다. 기존 연결과 이력은 남습니다.")) return;
                void run(async () => { await setCaseActive(purpose, caseId, false); return "비활성화했습니다."; });
              }}
              className="btn btn-secondary"
            >
              비활성화
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void run(async () => { await setCaseActive(purpose, caseId, true); return "재활성화했습니다."; })} className="btn btn-secondary">
              재활성화
            </button>
          )}
          {row.vector_status !== "ready" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => {
                const result = await retryVectors(purpose, [caseId]);
                return result.ready ? "벡터 반영을 완료했습니다." : "벡터 반영에 다시 실패했습니다. 원문은 저장돼 있습니다.";
              })}
              className="btn btn-secondary"
            >
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              벡터 재시도
            </button>
          )}
        </div>
        {!row.active && (
          <p className="note note-warn">비활성 사례입니다. 신규 검색·연결에서 빠지며, 기존 연결 {linked.length}건과 이력은 그대로 남아 있습니다.</p>
        )}

        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-neutral-400">사례 ID</dt>
          <dd className="break-all font-mono text-[11px] text-neutral-200">{row.case_id}</dd>
          <dt className="text-neutral-400">출처</dt>
          <dd className="text-neutral-200">{row.data_origin || "—"}</dd>
          {(schema?.fields ?? []).filter((field) => row[field.key]).map((field) => (
            <FieldRow key={field.key} label={field.label} value={row[field.key]} />
          ))}
          <dt className="text-neutral-400">검색 문장</dt>
          <dd className="whitespace-pre-wrap break-words text-neutral-300">{row.search_text}</dd>
          <dt className="text-neutral-400">등록 · 수정</dt>
          <dd className="tabular-nums text-neutral-300">{row.created_at} · {row.updated_at}</dd>
        </dl>

        <section aria-label="도면 연결">
          <h4 className="mb-1 text-[11px] font-semibold text-neutral-300">명시적 도면 연결 ({linked.length}건 연결 중)</h4>
          {detail.links.length === 0 ? (
            <p className="text-neutral-400">연결된 도면 항목이 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {detail.links.map((link) => (
                <li key={link.link_id} className="flex items-start gap-2 rounded border border-neutral-700 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-neutral-200">{link.part_name} · {link.drawing_name} · {link.item_id} <span className="text-neutral-400">{link.raw_text}</span></span>
                    <span className="block text-[11px] text-neutral-400">
                      OCR {link.ocr_revision.slice(0, 8)} · {link.linked ? `연결 ${link.created_at}` : `해제 ${link.unlinked_at}`}
                      {!link.location.openable && link.location.reason ? ` · ${link.location.reason}` : ""}
                    </span>
                  </span>
                  {link.location.openable && link.part_id && (
                    <button
                      type="button"
                      onClick={() => onOpenLocation({ part_id: link.part_id!, drawing_id: link.drawing_id, revision: link.ocr_revision, item_id: link.item_id })}
                      className="btn btn-ghost btn-icon"
                      aria-label="도면 위치 열기"
                      title="도면 위치 열기"
                    >
                      <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="이력">
          <h4 className="mb-1 text-[11px] font-semibold text-neutral-300">이력</h4>
          {detail.history.length === 0 ? (
            <p className="text-neutral-400">기록된 이력이 없습니다. 이력은 이 기능 도입 이후의 변경부터 남습니다.</p>
          ) : (
            <ol className="space-y-1">
              {detail.history.map((event) => (
                <li key={event.event_id} className="flex gap-2 text-[11px]">
                  <span className="w-32 shrink-0 tabular-nums text-neutral-400">{event.created_at}</span>
                  <span className="w-16 shrink-0 font-medium text-neutral-200">{ACTION_LABEL[event.action]}</span>
                  <span className="min-w-0 flex-1 text-neutral-400">
                    {event.item_id ? `${event.drawing_name ?? event.drawing_id} · ${event.item_id}` : historyDetail(event.detail)}
                    {" · 작성자 미기록"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

export function historyDetail(detail: Record<string, unknown>) {
  const via = detail.via === "excel" ? `엑셀 ${detail.file ?? ""} ${detail.row ?? ""}행` : detail.via === "point" ? "작업 화면 포인트 등록" : detail.via === "admin" ? "관리자 화면" : detail.via === "form" ? "등록 폼" : "";
  const fields = Array.isArray(detail.fields) && detail.fields.length ? ` (${(detail.fields as string[]).join(", ")})` : "";
  return `${via}${fields}`.trim() || "—";
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-400">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-neutral-100">{value}</dd>
    </>
  );
}

function CaseForm({
  purpose,
  schema,
  caseId,
  onCancel,
  onSaved,
}: {
  purpose: WorkPurpose;
  schema: PurposeSchema;
  caseId: string | null;
  onCancel: () => void;
  onSaved: (caseId: string, message: string) => void;
}) {
  const keys = useMemo(() => [...schema.fields.map((field) => field.key), "search_text"], [schema]);
  const empty = useMemo(() => Object.fromEntries(keys.map((key) => [key, ""])), [keys]);
  const [initial, setInitial] = useState<Record<string, string> | null>(caseId ? null : empty);
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    fetchCaseDetail(purpose, caseId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        const loaded = Object.fromEntries(keys.map((key) => [key, String(detail.case[key] ?? "")]));
        setInitial(loaded);
        setValues(loaded);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "사례 조회 실패");
      });
    return () => controller.abort();
  }, [purpose, caseId, keys]);

  const dirty = !!initial && keys.some((key) => (values[key] ?? "") !== (initial[key] ?? ""));
  useReportUnsaved(dirty);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      if (caseId) {
        const result = await updateCase(purpose, caseId, values);
        onSaved(caseId, result.saved === false ? result.message : `${result.message} (바뀐 항목 ${result.changed_fields.length}개)`);
      } else {
        const result = await createCase(purpose, values);
        onSaved(result.case_id, result.message);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장 실패");
      setSaving(false);
    }
  }

  if (!initial) return error ? <div className="p-3"><ErrorNote message={error} /></div> : <Loading />;

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <header className="card-header">
        <h3 className="text-xs font-semibold text-white">{caseId ? "사례 수정" : `${schema.label} 사례 등록`}</h3>
        {caseId && <span className="truncate font-mono text-[11px] text-neutral-400">{caseId}</span>}
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <p className="text-[11px] text-neutral-400">
          {schema.label} 저장소에만 저장됩니다. 도면 항목과의 연결은 바뀌지 않으며, 저장하면 벡터를 다시 반영합니다.
        </p>
        {schema.fields.map((field) => (
          <label key={field.key} className="block space-y-1">
            <span className="field-label">
              {field.label}
              {field.required && <span className="ml-0.5 text-rose-300">*</span>}
              <span className="ml-1 font-mono text-[10px] text-neutral-500">{field.key}</span>
            </span>
            {field.key === "feature_type" ? (
              <select value={values[field.key] || "UNKNOWN"} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} className="field">
                {schema.feature_types.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            ) : (
              <textarea
                rows={["error_description", "cause", "precaution", "corrective_action"].includes(field.key) ? 2 : 1}
                required={field.required}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                className="field resize-y"
              />
            )}
          </label>
        ))}
        <label className="block space-y-1">
          <span className="field-label">검색 문장 <span className="ml-1 font-mono text-[10px] text-neutral-500">search_text</span></span>
          <textarea
            rows={3}
            value={values.search_text ?? ""}
            onChange={(e) => setValues({ ...values, search_text: e.target.value })}
            placeholder="비워 두면 위 항목으로 자동 생성합니다."
            className="field resize-y"
          />
        </label>
        <ErrorNote message={error} />
      </div>
      <footer className="flex justify-end gap-2 border-t border-neutral-700 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            if (dirty && !window.confirm("저장하지 않은 입력이 사라집니다. 취소할까요?")) return;
            onCancel();
          }}
          className="btn btn-secondary"
        >
          취소
        </button>
        <button type="submit" disabled={saving || (!!caseId && !dirty)} className="btn btn-primary">
          {saving ? "저장 중…" : "저장"}
        </button>
      </footer>
    </form>
  );
}
