/**
 * 관리자 「오류 DB 관리」. 도면을 열지 않아도 쓰는 전체 관리 화면.
 * 목적(부품제작·조립·검증)을 고르면 그 목적의 원문·벡터 컬렉션·연결·이력만 보여준다 (섞지 않는다).
 *
 * 흐름 카드: 엑셀 업로드 → 목적별 오류 DB → 벡터 반영 → 도면·항목 연결
 * 카드마다 단위가 다르다: 업로드 = 업로드 횟수·파일 수, 오류 DB·벡터 = 사례 수, 도면 연결 = 연결 수.
 * 카드 숫자는 아래 상세 목록과 같은 기준(같은 테이블·같은 조건)으로 센다.
 */
import { useEffect, useState } from "react";
import { WORK_PURPOSES, type WorkPurpose } from "../../../lib/purpose";
import { useConfirmDiscard } from "../../../lib/unsavedChanges";
import { fetchSchema, fetchSummary, type ErrorDbSummary, type PurposeSchema } from "../../../lib/admin/errorDbAPI";
import { ErrorNote, FlowCard, FlowConnector, type LocationTarget } from "../adminUi";
import { CasePanel } from "./CasePanel";
import { LinksPanel } from "./LinksPanel";
import { UploadPanel } from "./UploadPanel";

type Step = "upload" | "cases" | "vector" | "links";

export function ErrorDbManager({ onOpenLocation }: { onOpenLocation: (target: LocationTarget) => void }) {
  const confirmDiscard = useConfirmDiscard();
  const [purpose, setPurpose] = useState<WorkPurpose>("manufacturing");
  const [step, setStep] = useState<Step>("cases");
  const [schema, setSchema] = useState<PurposeSchema | null>(null);
  const [summary, setSummary] = useState<ErrorDbSummary | null>(null);
  const [error, setError] = useState("");
  // 한 패널에서 바꾸면 카드 숫자와 다른 패널 목록을 다시 불러온다.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSchema(null);
    fetchSchema(purpose, controller.signal)
      .then((data) => !controller.signal.aborted && setSchema(data))
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "스키마 조회 실패"));
    return () => controller.abort();
  }, [purpose]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetchSummary(purpose, controller.signal)
      .then((data) => !controller.signal.aborted && setSummary(data))
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "집계 조회 실패"));
    return () => controller.abort();
  }, [purpose, version]);

  function go(next: Step) {
    if (next === step) return;
    if (!confirmDiscard("다른 단계로 이동")) return;
    setStep(next);
  }

  function changePurpose(next: WorkPurpose) {
    if (next === purpose) return;
    if (!confirmDiscard("다른 목적으로 이동")) return;
    setSummary(null);
    setPurpose(next);
  }

  const s = summary;
  const label = WORK_PURPOSES.find((entry) => entry.value === purpose)?.label ?? "";
  const changed = () => setVersion((v) => v + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="작업 목적" className="seg-dark">
          {WORK_PURPOSES.map((entry) => (
            <button key={entry.value} type="button" aria-pressed={purpose === entry.value} onClick={() => changePurpose(entry.value)} className="seg-item">
              {entry.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-neutral-400">
          {label} 오류 DB만 표시합니다. 원문 테이블·벡터 컬렉션은 목적마다 따로 있고, 다른 목적 사례는 섞지 않습니다.
        </p>
      </div>
      <ErrorNote message={error} />

      <div role="group" aria-label="오류 DB 흐름" className="flex flex-col gap-2 md:flex-row md:items-stretch">
        <FlowCard title="① 엑셀 업로드" active={step === "upload"} onClick={() => go("upload")}>
          <span className="text-lg font-semibold tabular-nums text-white">{s ? `${s.uploads.applied}회` : "—"}</span>
          <span className="text-[11px] text-neutral-400">
            {s ? `반영 파일 ${s.uploads.files}개 · 적재 행 ${s.uploads.rows}건 · 거부 ${s.uploads.rejected}회` : "불러오는 중"}
          </span>
          <span className="text-[10px] text-neutral-500">업로드 횟수 (기능 도입 이후)</span>
        </FlowCard>
        <FlowConnector />
        <FlowCard title={`② ${label} 오류 DB`} active={step === "cases"} onClick={() => go("cases")}>
          <span className="text-lg font-semibold tabular-nums text-white">{s ? `${s.cases.total}건` : "—"}</span>
          <span className="text-[11px] text-neutral-400">{s ? `활성 ${s.cases.active} · 비활성 ${s.cases.inactive}` : "불러오는 중"}</span>
          <span className="text-[10px] text-neutral-500">사례 수</span>
        </FlowCard>
        <FlowConnector />
        <FlowCard title="③ 벡터 반영" active={step === "vector"} onClick={() => go("vector")}>
          <span className="text-lg font-semibold tabular-nums text-white">{s ? `${s.vector.ready}건` : "—"}</span>
          <span className={`text-[11px] ${s && s.vector.failed ? "text-rose-300" : "text-neutral-400"}`}>
            {s ? `실패 ${s.vector.failed} · 대기 ${s.vector.pending}` : "불러오는 중"}
          </span>
          <span className="text-[10px] text-neutral-500">반영 완료 사례 수</span>
        </FlowCard>
        <FlowConnector />
        <FlowCard title="④ 도면·항목 연결" active={step === "links"} onClick={() => go("links")}>
          <span className="text-lg font-semibold tabular-nums text-white">{s ? `${s.links.active}건` : "—"}</span>
          <span className="text-[11px] text-neutral-400">{s ? `연결된 사례 ${s.links.cases}건 · 해제 ${s.links.unlinked}건` : "불러오는 중"}</span>
          <span className="text-[10px] text-neutral-500">연결 중인 연결 수 (도면 · OCR 버전 · 항목)</span>
        </FlowCard>
      </div>

      {step === "upload" ? (
        <UploadPanel purpose={purpose} schema={schema} refreshKey={version} onChanged={changed} />
      ) : step === "links" ? (
        <LinksPanel purpose={purpose} refreshKey={version} onChanged={changed} onOpenLocation={onOpenLocation} />
      ) : (
        <CasePanel purpose={purpose} schema={schema} mode={step} refreshKey={version} onChanged={changed} onOpenLocation={onOpenLocation} />
      )}
    </div>
  );
}
