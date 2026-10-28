import { AlertTriangle } from 'lucide-react';
import { PointErrorForm } from './PointErrorForm';
import { useEffect, useRef, useState } from 'react';
import { fetchItemErrors, type ErrorCandidate } from '../lib/drawingAPI';
import type { WorkPurpose } from '../lib/purpose';

/** 이 패널의 오류사례 검색·등록은 verification 저장소만 사용한다. */
const PURPOSE: WorkPurpose = 'verification';
import { type OcrItem, type OcrPoint } from '../lib/ocr';
import OcrMeasurementEntry from "./OcrMeasurementEntry";
import {
  measurementStatusLabels,
  type MeasurementRecord,
  type SavedMeasurement,
} from "../lib/measurementAPI";
import ItemHeader, { Chip, ProgressBar, type ChipTone } from './review/ItemHeader';
import { FEATURE_LABEL } from '../lib/inspection/instruments';
import { TOLERANCE_SOURCE_LABEL, formatDeviationPair, formatNumber } from '../lib/inspection/tolerance';

export interface ReviewInfo {
  reviewer: string;
  at: string;
}

const STATUS_TONE: Record<string, ChipTone> = {
  pending: 'info',
  completed: 'ok',
  remeasure: 'error',
  review_required: 'warn',
};

export function VerificationPanel({
  drawingId,
  revision,
  point,
  total,
  onNavigate,
  onMeasurementSaved,
  records = {},
  reviewInfo,
  readOnly = false,
}: {
  drawingId: string;
  revision: string;
  point?: OcrPoint;
  total: number;
  onNavigate: (delta: number) => void;
  onMeasurementSaved?: (record: SavedMeasurement) => void;
  /** item_id → 저장된 측정 결과 (진행률·상태 표시용) */
  records?: Record<string, MeasurementRecord>;
  reviewInfo?: ReviewInfo | null;
  /** 이 업무 담당이 아닌 작업자가 보는 중이면 true (측정 입력·오류 등록 잠금, 조회만) */
  readOnly?: boolean;
}) {
  const itemId = point?.source.id;
  const key = `${drawingId}/${revision}/${itemId}`;
  const [result, setResult] = useState<{ key: string; loading: boolean; errors: ErrorCandidate[]; error: string }>({ key: '', loading: true, errors: [], error: '' });
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    const token = ++sequence.current;
    setResult({ key, loading: true, errors: [], error: '' });
    fetchItemErrors(PURPOSE, drawingId, itemId, controller.signal).then((response) => {
      if (controller.signal.aborted || token !== sequence.current) return;
      if (response.drawing_id !== drawingId || response.item_id !== itemId || response.revision !== revision) {
        throw new Error('도면 결과가 변경됐습니다. 도면을 다시 선택해주세요.');
      }
      setResult({ key, loading: false, errors: response.errors, error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted && token === sequence.current) {
        setResult({ key, loading: false, errors: [], error: error.message || '검색 실패' });
      }
    });
    return () => { controller.abort(); ++sequence.current; };
  }, [drawingId, revision, itemId, key, retry]);
  if (!point) return <p className="p-5 text-sm text-slate-500">측정항목을 선택해주세요.</p>;
  const item = point.source;
  const loading = result.key !== key || result.loading;
  const record = records[item.id];
  const recordList = Object.values(records);
  const done = recordList.filter((entry) => entry.status === 'completed').length;
  const failed = recordList.filter((entry) => entry.judgement === 'fail').length;

  return (
    <section className="flex min-h-full flex-col bg-slate-50 text-slate-800">
      <div className="sticky top-0 z-10 shadow-sm">
        <ItemHeader
          number={point.displayNumber}
          total={total}
          title={point.feature.name}
          rawText={item.raw_text}
          itemId={item.id}
          onNavigate={onNavigate}
          chips={
            <>
              {reviewInfo ? (
                <Chip tone="ok">
                  검토 완료 · {reviewInfo.reviewer || '검토자 미기록'}
                  {reviewInfo.at ? ` ${reviewInfo.at}` : ''}
                </Chip>
              ) : (
                <Chip tone="warn">검토 전</Chip>
              )}
              <Chip tone={record ? STATUS_TONE[record.status] ?? 'neutral' : 'neutral'}>
                측정: {record
                  ? `${record.judgement === 'pass' ? '적합' : record.judgement === 'fail' ? '부적합' : '판정 보류'} · ${measurementStatusLabels[record.status]}`
                  : '대기'}
              </Chip>
            </>
          }
        />
        <ProgressBar
          label="측정 완료"
          done={done}
          total={total}
          chips={failed > 0 ? <Chip tone="error">불합격 {failed}</Chip> : null}
        />
      </div>

      <div className="flex-1 space-y-3 p-3">
        <CriteriaCard item={item} />
        <OcrMeasurementEntry
          purpose={PURPOSE}
          readOnly={readOnly}
          key={`measurement-${key}`}
          drawingId={drawingId}
          revision={revision}
          item={item}
          onSaved={onMeasurementSaved}
        />
        <section aria-label="측정 전 확인 · 관련 오류사례" className="card border-amber-300">
          <header className="card-header border-amber-200 bg-amber-50">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              측정 전 확인 · 관련 오류사례
            </h3>
            {!loading && !result.error && <span className="tag bg-amber-100 text-amber-900">{result.errors.length}건</span>}
          </header>
          {loading ? <p role="status" className="p-3 text-xs text-slate-600">관련 오류·주의사항 검색 중…</p>
            : result.error ? <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-xs text-rose-700"><span className="min-w-0 flex-1">{result.error}</span><button type="button" onClick={() => setRetry((v) => v + 1)} className="btn btn-secondary h-6">다시 검색</button></div>
            : !result.errors.length ? <p className="p-3 text-xs text-slate-600">조건에 맞는 등록 사례가 없습니다. 안전함을 의미하지는 않습니다.</p>
            : <div className="divide-y divide-slate-200">{result.errors.map((error) => <article key={error.case_id} className="space-y-2 p-3 text-xs">
              <div>
                <h4 className="text-[13px] font-semibold leading-snug text-slate-900">{error.case_title || error.case_id}</h4>
                <p className="mt-0.5 text-[11px] text-slate-500">{error.case_id}{error.data_origin === 'SYNTHETIC' ? ' · 가상 테스트 사례' : error.data_origin === 'USER_REPORTED' ? ' · 사용자 등록 사례' : ''} · 적용 조건 확인 필요</p>
              </div>
              <p className="leading-relaxed text-slate-800">{error.error_description}</p>
              {error.precaution && <p className="note note-ok"><b className="mr-1 font-semibold">주의사항</b>{error.precaution}</p>}
              {(error.cause || error.recommended_instrument || error.applicable_condition || error.exclude_condition) && (
                <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 leading-relaxed">
                  {error.cause && <><dt className="text-slate-500">원인</dt><dd className="text-slate-800">{error.cause}</dd></>}
                  {error.recommended_instrument && <><dt className="text-slate-500">측정기 후보</dt><dd className="text-slate-800">{error.recommended_instrument}</dd></>}
                  {error.applicable_condition && <><dt className="text-slate-500">적용 조건</dt><dd className="text-slate-800">{error.applicable_condition}</dd></>}
                  {error.exclude_condition && <><dt className="text-slate-500">제외·확인 조건</dt><dd className="text-slate-800">{error.exclude_condition}</dd></>}
                </dl>
              )}
              <p className="text-[11px] text-slate-400">출처: {error.source_file === 'user_form' ? '사용자 등록' : error.source_file || '오류사례 DB'}</p>
            </article>)}</div>}
        </section>
        <PointErrorForm key={`error-form-${key}`} purpose={PURPOSE} readOnly={readOnly} drawingId={drawingId} revision={revision} item={item} number={point.displayNumber} onIndexed={()=>setRetry(v=>v+1)} />
      </div>
    </section>
  );
}

/** 관리자가 확정한 검사 기준 (관리자 화면의 '작업자 검사 기준' 카드와 같은 내용, 읽기 전용). */
function CriteriaCard({ item }: { item: OcrItem }) {
  const approved = item.inspection_approved === true;
  const numeric = (item.measurement_mode ?? 'numeric') === 'numeric';
  const hasRange = typeof item.lower_limit === 'number' && typeof item.upper_limit === 'number';

  if (!approved) {
    return (
      <div className="note note-warn space-y-1">
        <h3 className="text-xs font-semibold">검사 기준 미지정</h3>
        <p>관리자가 이 항목의 검사 기준을 아직 지정하지 않았습니다. 측정값은 기록되지만 자동 판정하지 않습니다.</p>
        <p className="font-mono text-slate-700">도면 표기: {item.raw_text.replace(/\n/g, '  ')}</p>
      </div>
    );
  }

  return (
    <section aria-label="검사 기준" className="card text-xs">
      <header className="card-header">
        <h3 className="text-xs font-semibold text-slate-900">검사 기준</h3>
        <span className="text-[11px] text-slate-500">관리자 지정 · 읽기 전용</span>
      </header>
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 p-3">
        <dt className="text-slate-500">측정 방식</dt>
        <dd>{numeric ? '실측값 입력 · 자동 판정' : '합격 / 불합격 기록'}</dd>
        <dt className="text-slate-500">측정 형상</dt>
        <dd>{FEATURE_LABEL[item.feature_type ?? ''] ?? '-'}</dd>
        {numeric ? (
          <>
            {typeof item.nominal_value === 'number' && (
              <>
                <dt className="text-slate-500">기준치수</dt>
                <dd className="font-mono">{formatNumber(item.nominal_value)} {item.unit ?? ''}</dd>
              </>
            )}
            {typeof item.upper_deviation === 'number' && typeof item.lower_deviation === 'number' && (
              <>
                <dt className="text-slate-500">공차</dt>
                <dd>
                  <span className="font-mono">{formatDeviationPair(item.upper_deviation, item.lower_deviation)}</span>
                  {item.tolerance_source && (
                    <span className="ml-1.5 text-[11px] text-slate-500">{TOLERANCE_SOURCE_LABEL[item.tolerance_source]}{item.tolerance_basis === "project_default" ? " · 프로젝트 기본 정책 (도면 표기 아님)" : ""}</span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-slate-500">허용 범위</dt>
            <dd>
              {hasRange ? (
                <>
                  <b className="font-mono text-[13px] font-semibold text-slate-900">
                    {formatNumber(item.lower_limit as number)} ~ {formatNumber(item.upper_limit as number)} {item.unit ?? ''}
                  </b>
                </>
              ) : (
                '기준 없음'
              )}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-slate-500">판정 기준</dt>
            <dd className="whitespace-pre-wrap">{item.gauge_criteria || '-'}</dd>
          </>
        )}
        <dt className="text-slate-500">측정기</dt>
        <dd>{item.instrument || '-'}</dd>
      </dl>
    </section>
  );
}
