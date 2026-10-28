/**
 * 도면·측정항목에 명시적으로 연결한 사례(연결·해제 내역)와 전체 변경 이력.
 * 연결 기준은 도면 ID + OCR 버전 + 항목 ID. 현재 OCR 버전 항목만 도면 위치를 연다 (과거 버전 위치는 재현하지 않는다).
 */
import { useEffect, useState } from "react";
import { MapPin, Unlink } from "lucide-react";
import type { WorkPurpose } from "../../../lib/purpose";
import {
  ACTION_LABEL,
  fetchHistory,
  fetchLinks,
  unlinkCase,
  type CaseLink,
  type HistoryAction,
  type HistoryEvent,
} from "../../../lib/admin/errorDbAPI";
import { Empty, ErrorNote, Loading, Tag, type LocationTarget } from "../adminUi";
import { activeTag, historyDetail } from "./CasePanel";

export function LinksPanel({
  purpose,
  refreshKey,
  onChanged,
  onOpenLocation,
}: {
  purpose: WorkPurpose;
  refreshKey: number;
  onChanged: () => void;
  onOpenLocation: (target: LocationTarget) => void;
}) {
  const [tab, setTab] = useState<"links" | "history">("links");
  const [state, setState] = useState<"active" | "unlinked" | "all">("active");
  const [action, setAction] = useState<HistoryAction | "">("");
  const [links, setLinks] = useState<CaseLink[] | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (tab === "links") {
      setLinks(null);
      fetchLinks(purpose, { state }, controller.signal)
        .then((data) => !controller.signal.aborted && setLinks(data.items))
        .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "연결 조회 실패"));
    } else {
      setHistory(null);
      fetchHistory(purpose, { action: action || undefined, limit: 300 }, controller.signal)
        .then((data) => !controller.signal.aborted && setHistory(data.items))
        .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "이력 조회 실패"));
    }
    return () => controller.abort();
  }, [purpose, tab, state, action, reload, refreshKey]);

  async function unlink(link: CaseLink) {
    if (!window.confirm(`${link.item_id} 항목과 ${link.case_id} 사례의 연결을 해제할까요?\n사례 원문과 다른 항목의 연결은 그대로 남습니다.`)) return;
    try {
      await unlinkCase(purpose, link.link_id);
      setReload((v) => v + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연결 해제 실패");
    }
  }

  return (
    <section aria-label="도면 연결과 이력" className="card flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <header className="card-header flex-wrap">
        <div role="group" aria-label="보기" className="seg-dark">
          <button type="button" aria-pressed={tab === "links"} onClick={() => setTab("links")} className="seg-item">연결 내역</button>
          <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")} className="seg-item">전체 이력</button>
        </div>
        {tab === "links" ? (
          <select aria-label="연결 상태" value={state} onChange={(e) => setState(e.target.value as typeof state)} className="field w-auto">
            <option value="active">연결 중</option>
            <option value="unlinked">해제됨</option>
            <option value="all">전체</option>
          </select>
        ) : (
          <select aria-label="동작" value={action} onChange={(e) => setAction(e.target.value as HistoryAction | "")} className="field w-auto">
            <option value="">모든 동작</option>
            {(Object.keys(ACTION_LABEL) as HistoryAction[]).map((key) => <option key={key} value={key}>{ACTION_LABEL[key]}</option>)}
          </select>
        )}
      </header>
      <div className="px-3 pt-2"><ErrorNote message={error} /></div>
      <p className="px-3 pt-1 text-[11px] text-neutral-400">
        {tab === "links"
          ? "작업 화면에서 항목에 등록한 사례와 관리자가 연결한 사례입니다. 자동 검색 추천은 연결이 아니므로 여기에 나오지 않습니다."
          : "이력은 이 기능 도입 이후부터 기록됩니다. 서버 인증이 없어 작성자는 기록하지 않습니다."}
      </p>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "links" ? (
          !links ? <Loading /> : links.length === 0 ? <Empty>해당하는 연결이 없습니다.</Empty> : (
            <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#2e2e2e] text-[11px] text-neutral-400">
                <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                  <th>사례</th><th>부품 · 도면</th><th>OCR 버전</th><th>항목</th><th>구분</th><th>시각</th><th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.link_id} className="[&>td]:border-b [&>td]:border-neutral-700 [&>td]:px-3 [&>td]:py-2 [&>td]:align-top">
                    <td>
                      <span className="block text-neutral-100">{link.case_title}</span>
                      <span className="flex items-center gap-1 font-mono text-[11px] text-neutral-400">{link.case_id} {!link.case_active && activeTag(false)}</span>
                    </td>
                    <td className="text-neutral-300">{link.part_name ?? "—"} · {link.drawing_name ?? link.drawing_id}</td>
                    <td className="font-mono text-[11px] text-neutral-400">
                      {link.ocr_revision.slice(0, 8)}
                      {!link.location.openable && <span className="mt-0.5 block font-sans text-amber-300">{link.location.reason}</span>}
                    </td>
                    <td className="text-neutral-200">{link.item_id} <span className="text-neutral-400">{link.raw_text}</span></td>
                    <td>{link.linked ? <Tag tone="info">연결 중</Tag> : <Tag tone="muted">해제됨</Tag>}<span className="ml-1 text-[11px] text-neutral-500">{link.source === "admin" ? "관리자" : "현장 등록"}</span></td>
                    <td className="whitespace-nowrap text-[11px] tabular-nums text-neutral-400">
                      {link.created_at}
                      {link.unlinked_at && <><br />해제 {link.unlinked_at}</>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {link.location.openable && link.part_id && (
                        <button
                          type="button"
                          title="도면 위치 열기"
                          aria-label="도면 위치 열기"
                          onClick={() => onOpenLocation({ part_id: link.part_id!, drawing_id: link.drawing_id, revision: link.ocr_revision, item_id: link.item_id })}
                          className="btn btn-ghost btn-icon"
                        >
                          <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {link.linked && (
                        <button type="button" title="연결 해제" aria-label="연결 해제" onClick={() => void unlink(link)} className="btn btn-ghost btn-icon">
                          <Unlink aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !history ? <Loading /> : history.length === 0 ? <Empty>기록된 이력이 없습니다.</Empty> : (
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#2e2e2e] text-[11px] text-neutral-400">
              <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                <th>시각</th><th>동작</th><th>사례</th><th>목적</th><th>부품 · 도면</th><th>OCR 버전 · 항목</th><th>작성자</th><th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {history.map((event) => (
                <tr key={event.event_id} className="[&>td]:border-b [&>td]:border-neutral-700 [&>td]:px-3 [&>td]:py-2 [&>td]:align-top">
                  <td className="whitespace-nowrap text-[11px] tabular-nums text-neutral-400">{event.created_at}</td>
                  <td className="font-medium text-neutral-100">{ACTION_LABEL[event.action]}</td>
                  <td>
                    <span className="block text-neutral-200">{event.case_title ?? "—"}</span>
                    <span className="font-mono text-[11px] text-neutral-400">{event.case_id}</span>
                  </td>
                  <td className="text-neutral-300">{event.purpose === "manufacturing" ? "부품제작" : event.purpose === "assembly" ? "조립" : "검증"}</td>
                  <td className="text-neutral-300">{event.drawing_id ? `${event.part_name ?? "—"} · ${event.drawing_name ?? event.drawing_id}` : historyDetail(event.detail)}</td>
                  <td className="text-[11px] text-neutral-400">
                    {event.item_id ? <><span className="font-mono">{event.ocr_revision?.slice(0, 8)}</span> · {event.item_id}</> : "—"}
                    {event.item_id && !event.location.openable && <span className="block text-amber-300">{event.location.reason}</span>}
                  </td>
                  <td className="text-[11px] text-neutral-500">미기록</td>
                  <td className="text-right">
                    {event.item_id && event.location.openable && event.part_id && (
                      <button
                        type="button"
                        title="도면 위치 열기"
                        aria-label="도면 위치 열기"
                        onClick={() => onOpenLocation({ part_id: event.part_id!, drawing_id: event.drawing_id!, revision: event.ocr_revision!, item_id: event.item_id! })}
                        className="btn btn-ghost btn-icon"
                      >
                        <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
