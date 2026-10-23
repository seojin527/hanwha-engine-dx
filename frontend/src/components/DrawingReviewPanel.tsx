import { useEffect, useState } from "react";
import {
  saveDrawingReview,
  type DrawingReviewResponse,
  type DrawingReviewSource,
  type ReviewPreviewMarker,
  type InspectionSetting,
} from "../lib/admin/drawingReviewAPI";

interface Props {
  source: DrawingReviewSource;
  onSaved: (result: DrawingReviewResponse) => void;
  onSelectItem?: (itemId: string) => void;
  onPickPosition?: () => Promise<{ x: number; y: number } | null>;
  onPreviewChange?: (markers: ReviewPreviewMarker[]) => void;
  selectedItemId?: string | null;
}

interface GdtEdit {
  value: string;
  symbol: string;
  datums: string;
}
interface InspectionDraft {
  mode: "numeric" | "gauge";
  feature: string;
  nominal: string;
  upper: string;
  lower: string;
  unit: string;
  instrument: string;
  criteria: string;
  positionConfirmed: boolean;
}

interface AddedDimension {
  id: string;
  text: string;
  x: string;
  y: string;
  positionConfirmed?: boolean;
}

const inputClass =
  "w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900";

export default function DrawingReviewPanel({
  source,
  selectedItemId,
  onSaved,
  onSelectItem,
  onPickPosition,
  onPreviewChange,
}: Props) {
  const [dimensions, setDimensions] = useState<Record<string, string>>({});
  const [gdt, setGdt] = useState<Record<string, GdtEdit>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<AddedDimension[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [inspection, setInspection] =
    useState<Record<string, InspectionDraft>>({});
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

  const selectedId =
    selectedItemId ??
    localSelectedId ??
    source.result.items[0]?.id ??
    null;

  function selectItem(itemId: string) {
    setLocalSelectedId(itemId);
    onSelectItem?.(itemId);
  }
  // 여기까지 추가

  // 도면이나 OCR 버전이 바뀌면 이전 도면의 편집 상태를 비운다.
  useEffect(() => {
    setDimensions(
      Object.fromEntries(
        source.review.dimensions.map((item) => [item.item_id, item.text]),
      ),
    );
    setGdt(
      Object.fromEntries(
        source.review.gdt.map((item) => [
          item.item_id,
          {
            value: item.value,
            symbol: item.symbol,
            datums: item.datums.join(", "),
          },
        ]),
      ),
    );
      setInspection(
      Object.fromEntries(
        source.result.items.map((item) => [
          item.id,
          {
            mode: item.measurement_mode ?? "numeric",
            feature: item.feature_type ?? "",
            nominal: String(item.nominal_value ?? ""),
            upper: String(item.upper_deviation ?? ""),
            lower: String(item.lower_deviation ?? ""),
            unit: item.unit ?? "",
            instrument: item.instrument ?? "",
            criteria: item.gauge_criteria ?? "",
            positionConfirmed: false,
          },
        ]),
      ),
    );
    setConfirmed({});
    setAdded([]);
    setError("");
  }, [source]);

  const points = source.result.items;
  const confirmedCount = points.filter((item) => confirmed[item.id]).length;
  const allConfirmed = points.length > 0 && confirmedCount === points.length;

    useEffect(() => {
    const markers: ReviewPreviewMarker[] = [];

    added.forEach((item, index) => {
      if (!item.x.trim() || !item.y.trim()) return;

      const x = Number(item.x);
      const y = Number(item.y);

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x >= source.result.image.width_px ||
        y >= source.result.image.height_px
      ) {
        return;
      }

      markers.push({
        id: item.id,
        number: source.result.items.length + index + 1,
        text: item.text,
        x,
        y,
      });
    });

    onPreviewChange?.(markers);
  }, [added, source, onPreviewChange]);

  
  useEffect(() => {
    return () => onPreviewChange?.([]);
  }, [onPreviewChange]);

  function invalidate(itemId: string) {
    setConfirmed((previous) => ({ ...previous, [itemId]: false }));
    setError("");
  }
  function updateInspection(
    itemId: string,
    patch: Partial<InspectionDraft>,
  ) {
    setInspection((previous) => ({
      ...previous,
      [itemId]: {
        ...previous[itemId],
        ...patch,
      },
    }));

    invalidate(itemId);
  }

  function updateGdt(
    parentId: string,
    rowId: string,
    field: keyof GdtEdit,
    value: string,
  ) {
    setGdt((previous) => ({
      ...previous,
      [rowId]: { ...previous[rowId], [field]: value },
    }));
    invalidate(parentId);
  }

  function updateAdded(id: string, patch: Partial<AddedDimension>) {
    setAdded((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              positionConfirmed:
                patch.x !== undefined || patch.y !== undefined
                  ? false
                  : patch.positionConfirmed ?? item.positionConfirmed,
            }
          : item,
      ),
    );
    setError("");
  }

  function confirmAddedPosition(item: AddedDimension) {
    const x = Number(item.x);
    const y = Number(item.y);

    if (
      !item.text.trim() ||
      !item.x.trim() ||
      !item.y.trim() ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= source.result.image.width_px ||
      y >= source.result.image.height_px
    ) {
      setError("치수 표기를 입력하고 도면 안의 위치를 선택해주세요.");
      return;
    }

    updateAdded(item.id, { positionConfirmed: true });
  }

  async function pickPosition(id: string) {
    if (!onPickPosition) return;
    setPicking(true);
    setError("");
    try {
      const position = await onPickPosition();
      if (position) {
        updateAdded(id, {
          x: String(Math.round(position.x)),
          y: String(Math.round(position.y)),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "위치 선택 실패");
    } finally {
      setPicking(false);
    }
  }

    async function save() {
    setError("");

    if (saving) return;

    if (picking) {
      setError("도면 위치 선택을 완료하거나 취소해주세요.");
      return;
    }

    if (!allConfirmed) {
      setError(
        `미확인 항목이 ${points.length - confirmedCount}개 있습니다. 모든 항목을 확인해주세요.`,
      );
      return;
    }

    if (!reviewer.trim()) {
      setError("검토자 이름을 입력해주세요.");
      return;
    }

    if (added.some((item) => !item.positionConfirmed)) {
      setError("추가한 치수의 「측정 위치 확정」을 먼저 눌러주세요.");
      return;
    }

    const addedItems = added.map((item) => ({
      text: item.text.trim(),
      x: Number(item.x),
      y: Number(item.y),
      coord: "image" as const,
    }));

    const invalid = added.some((item, index) => {
      const parsed = addedItems[index];
      return (
        !item.x.trim() ||
        !item.y.trim() ||
        !parsed.text ||
        !Number.isFinite(parsed.x) ||
        !Number.isFinite(parsed.y) ||
        parsed.x < 0 ||
        parsed.y < 0 ||
        parsed.x >= source.result.image.width_px ||
        parsed.y >= source.result.image.height_px
      );
    });

    if (invalid) {
      setError("추가 치수의 표기와 이미지 범위 안의 X·Y 좌표를 확인해주세요.");
      return;
    }

        const inspectionSettings: Record<string, InspectionSetting> = {};

    for (const item of points) {
      const draft = inspection[item.id];

      // 체크한 항목의 검사 기준만 적용한다.
      if (!draft?.positionConfirmed) continue;

      const supportedFeatures = [
        "HOLE", "SHAFT", "PLANE", "SLOT",
        "THREAD", "EDGE", "RADIUS", "CHAMFER",
      ];

      if (!supportedFeatures.includes(draft.feature)) {
        setError(`${item.id}: 측정 형상을 선택해주세요.`);
        return;
      }

      if (!draft.instrument.trim()) {
        setError(`${item.id}: 사용할 측정기를 입력해주세요.`);
        return;
      }

      const setting: InspectionSetting = {
        measurement_mode: draft.mode,
        feature_type: draft.feature,
        unit: draft.unit.trim(),
        instrument: draft.instrument.trim(),
        gauge_criteria: draft.criteria.trim(),
        position_confirmed: true,
      };

      if (draft.mode === "numeric") {
        if (item.category !== "DIMENSION") {
          setError(`${item.id}: 기하공차 숫자 판정은 아직 지원하지 않습니다.`);
          return;
        }

        const texts = [draft.nominal, draft.upper, draft.lower];
        const values = texts.map((text) => Number(text));

        if (
          texts.some((text) => !text.trim()) ||
          values.some((value) => !Number.isFinite(value))
        ) {
          setError(`${item.id}: 기준치수와 상한·하한 편차를 입력해주세요.`);
          return;
        }

        if (!draft.unit.trim()) {
          setError(`${item.id}: 측정 단위를 입력해주세요.`);
          return;
        }

        if (values[0] < 0 || values[2] > values[1]) {
          setError(`${item.id}: 기준치수와 편차의 범위를 확인해주세요.`);
          return;
        }

        setting.nominal_value = values[0];
        setting.upper_deviation = values[1];
        setting.lower_deviation = values[2];
      } else if (!draft.criteria.trim()) {
        setError(`${item.id}: 게이지 검사 기준을 입력해주세요.`);
        return;
      }

      inspectionSettings[item.id] = setting;
    }

    setSaving(true);
    try {
      const result = await saveDrawingReview(source.drawing_id, {
        revision: source.revision,
        reviewer: reviewer.trim(),
        confirmed_item_ids: points.map((item) => item.id),
        inspection_settings: inspectionSettings,
        edits: {
          gdt: source.review.gdt.map((row) => {
            const edit = gdt[row.item_id];
            return {
              item_id: row.item_id,
              value: edit?.value ?? row.value,
              symbol: edit?.symbol ?? row.symbol,
              datums: (edit?.datums ?? row.datums.join(","))
                .split(",")
                .map((datum) => datum.trim().toUpperCase())
                .filter(Boolean),
            };
          }),
          dimensions: source.review.dimensions
            .filter(
              (item) =>
                (dimensions[item.item_id] ?? item.text) !== item.text,
            )
            .map((item) => ({
              item_id: item.item_id,
              text: dimensions[item.item_id] ?? item.text,
            })),
          added_dimensions: addedItems,
        },
      });
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "검수 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 bg-white p-4 text-slate-900">
      <div>
        <h2 className="font-bold">관리자 검토</h2>
        <p className="mt-1 text-xs text-slate-600">
          확인 {confirmedCount} / {points.length} · 값을 수정하면 해당 항목의
          확인이 해제됩니다.
        </p>
      </div>

      {source.review.warnings.map((warning, index) => (
        <p key={index} className="text-xs text-amber-800">
          {warning}
        </p>
      ))}

      {error && (
        <p role="alert" className="whitespace-pre-wrap text-xs text-red-700">
          {error}
        </p>
      )}

      <fieldset disabled={saving || picking} className="space-y-4">
        <label className="block space-y-1 text-xs">
          <span>검토자</span>
          <input
            className={inputClass}
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="검토자 이름"
          />
        </label>

                <div
          role="group"
          aria-label="검토 항목 필터"
          className="flex flex-wrap gap-1.5"
        >
          {[
            { value: "all", label: "전체" },
            { value: "DIMENSION", label: "치수" },
            { value: "GDT", label: "기하공차" },
            { value: "unconfirmed", label: "미확인" },
            { value: "warn", label: "확인 필요" },
            { value: "edited", label: "수정됨" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                filter === option.value
                  ? "border-cyan-600 bg-cyan-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-cyan-400 hover:bg-cyan-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

                <div
          aria-label="검토 항목 목록"
          className="max-h-72 overflow-y-auto rounded border border-slate-200"
        >
          {points.map((item, index) => {
            const number = Number(item.id.match(/_(\d+)$/)?.[1]);

            const dim = source.review.dimensions.find(
              (entry) =>
                item.category === "DIMENSION" && entry.no === number,
            );

            const rows =
              item.category === "GDT"
                ? source.review.gdt.filter(
                    (entry) => entry.entry_no === number,
                  )
                : [];

            const edited =
              (dim !== undefined &&
                (dimensions[dim.item_id] ?? dim.text) !== dim.text) ||
              rows.some((row) => {
                const edit = gdt[row.item_id];
                return (
                  edit !== undefined &&
                  (edit.value !== row.value ||
                    edit.symbol !== row.symbol ||
                    edit.datums !== row.datums.join(", "))
                );
              });

            const hasWarning =
              !!item.requires_review ||
              !!item.coordinate_requires_review ||
              rows.some((row) => row.status === "format_error");

            if (filter === "unconfirmed" && confirmed[item.id]) return null;
            if (filter === "warn" && !hasWarning) return null;
            if (filter === "edited" && !edited) return null;

            if (
              (filter === "DIMENSION" || filter === "GDT") &&
              item.category !== filter
            ) {
              return null;
            }

            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 border-b px-3 py-2 last:border-b-0 ${
                  selectedId === item.id
                    ? "bg-cyan-50 ring-1 ring-inset ring-cyan-500"
                    : "bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`${index + 1}번 항목 확인`}
                  checked={!!confirmed[item.id]}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setConfirmed((previous) => ({
                      ...previous,
                      [item.id]: checked,
                    }));
                  }}
                />

                <button
                  type="button"
                  onClick={() => selectItem(item.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-bold">
                    {index + 1}번 ·{" "}
                    {dim
                      ? dimensions[dim.item_id] ?? dim.text
                      : item.raw_text}
                  </span>

                  <span className="text-[11px] text-slate-500">
                    {item.category === "GDT" ? "기하공차" : "치수"}
                    {confirmed[item.id] ? " · 확인 완료" : " · 미확인"}
                    {edited ? " · 수정됨" : ""}
                    {hasWarning ? " · 확인 필요" : ""}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <h3 className="border-t pt-3 text-sm font-bold">
          선택한 항목 상세 검토
        </h3>

        <div className="space-y-3">
          {points.map((item, index) => {
            if (item.id !== selectedId) return null;
                        const number = Number(item.id.match(/_(\d+)$/)?.[1]);

            const dim = source.review.dimensions.find(
              (entry) =>
                entry.no === number && item.category === "DIMENSION",
            );

            const rows =
              item.category === "GDT"
                ? source.review.gdt.filter(
                    (entry) => entry.entry_no === number,
                  )
                : [];

            const edited =
              (dim !== undefined &&
                (dimensions[dim.item_id] ?? dim.text) !== dim.text) ||
              rows.some((row) => {
                const edit = gdt[row.item_id];
                if (!edit) return false;

                return (
                  edit.value !== row.value ||
                  edit.symbol !== row.symbol ||
                  edit.datums !== row.datums.join(", ")
                );
              });

            const hasWarning =
              !!item.requires_review ||
              !!item.coordinate_requires_review ||
              rows.some((row) => row.status === "format_error");


            function revertItem() {
              if (dim) {
                setDimensions((previous) => ({
                  ...previous,
                  [dim.item_id]: dim.text,
                }));
              }

              setGdt((previous) => {
                const next = { ...previous };

                for (const row of rows) {
                  next[row.item_id] = {
                    value: row.value,
                    symbol: row.symbol,
                    datums: row.datums.join(", "),
                  };
                }

                return next;
              });

              invalidate(item.id);
            }

            return (
              <div key={item.id} className="space-y-2 rounded border p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-xs font-bold"
                    onClick={() => selectItem(item.id)}
                  >
                    {index + 1}번 · {item.raw_text}
                  </button>
                  <label className="flex shrink-0 items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={!!confirmed[item.id]}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;

                        setConfirmed((previous) => ({
                          ...previous,
                          [item.id]: checked,
                        }));
                      }}
                    />
                    확인
                  </label>
                </div>

                                {hasWarning && (
                  <p className="text-xs text-amber-800">
                    확인이 필요합니다.{" "}
                    {(item.review_reasons ?? []).join(" / ")}
                  </p>
                )}

                {edited && (
                  <div className="space-y-2 rounded bg-amber-50 p-2">
                    <p className="text-xs font-bold text-amber-800">
                      저장 전 수정 있음
                    </p>

                    <p className="whitespace-pre-wrap text-xs text-slate-600">
                      수정 전: {item.raw_text}
                    </p>

                    <button
                      type="button"
                      onClick={revertItem}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      마지막 저장값으로 되돌리기
                    </button>
                  </div>
                )} 

                                {inspection[item.id] && (
                  <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/40 p-3">
                    <h4 className="text-sm font-bold text-cyan-900">
                      작업자 검사 기준
                    </h4>

                    <label className="block space-y-1 text-xs">
                      <span>측정 방식</span>
                      <select
                        className={inputClass}
                        value={inspection[item.id].mode}
                        onChange={(event) =>
                          updateInspection(item.id, {
                            mode: event.target.value as "numeric" | "gauge",
                          })
                        }
                      >
                        <option value="numeric">실측값 입력</option>
                        <option value="gauge">게이지 검사</option>
                      </select>
                    </label>

                    <label className="block space-y-1 text-xs">
                      <span>측정 형상</span>
                      <select
                        className={inputClass}
                        value={inspection[item.id].feature}
                        onChange={(event) =>
                          updateInspection(item.id, {
                            feature: event.target.value,
                          })
                        }
                      >
                        <option value="">선택해주세요</option>
                        <option value="UNKNOWN">미확정</option>
                        <option value="HOLE">구멍</option>
                        <option value="SHAFT">축·외경</option>
                        <option value="PLANE">평면·길이 측정면</option>
                        <option value="SLOT">홈</option>
                        <option value="THREAD">나사</option>
                        <option value="EDGE">모서리</option>
                        <option value="RADIUS">반지름</option>
                        <option value="CHAMFER">모따기</option>
                      </select>
                    </label>

                    {inspection[item.id].mode === "numeric" ? (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1 text-xs">
                            <span>기준치수</span>
                            <input
                              className={inputClass}
                              inputMode="decimal"
                              value={inspection[item.id].nominal}
                              onChange={(event) =>
                                updateInspection(item.id, {
                                  nominal: event.target.value,
                                })
                              }
                            />
                          </label>

                          <label className="space-y-1 text-xs">
                            <span>단위</span>
                            <input
                              className={inputClass}
                              placeholder="예: mm"
                              value={inspection[item.id].unit}
                              onChange={(event) =>
                                updateInspection(item.id, {
                                  unit: event.target.value,
                                })
                              }
                            />
                          </label>

                          <label className="space-y-1 text-xs">
                            <span>상한 편차 · 부호 포함</span>
                            <input
                              className={inputClass}
                              inputMode="decimal"
                              placeholder="예: +0.2"
                              value={inspection[item.id].upper}
                              onChange={(event) =>
                                updateInspection(item.id, {
                                  upper: event.target.value,
                                })
                              }
                            />
                          </label>

                          <label className="space-y-1 text-xs">
                            <span>하한 편차 · 부호 포함</span>
                            <input
                              className={inputClass}
                              inputMode="decimal"
                              placeholder="예: -0.2"
                              value={inspection[item.id].lower}
                              onChange={(event) =>
                                updateInspection(item.id, {
                                  lower: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>

                        <p className="text-[11px] text-slate-600">
                          허용범위는 기준치수에 각 편차를 더해 계산합니다.
                          도면에 명시되거나 적용이 확인된 공차를 입력해주세요.
                        </p>

                        {item.category !== "DIMENSION" && (
                          <p className="text-xs text-amber-800">
                            기하공차의 숫자 판정은 아직 지원하지 않습니다.
                            실제 검사 방식에 맞는 기준 연결이 필요합니다.
                          </p>
                        )}
                      </>
                    ) : (
                      <label className="block space-y-1 text-xs">
                        <span>게이지 검사 기준</span>
                        <textarea
                          className={inputClass}
                          rows={3}
                          placeholder="사용할 게이지 규격과 적합·부적합 조건을 입력하세요."
                          value={inspection[item.id].criteria}
                          onChange={(event) =>
                            updateInspection(item.id, {
                              criteria: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}

                    <label className="block space-y-1 text-xs">
                      <span>사용 측정기</span>
                      <input
                        className={inputClass}
                        placeholder="예: 버니어 캘리퍼스"
                        value={inspection[item.id].instrument}
                        onChange={(event) =>
                          updateInspection(item.id, {
                            instrument: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label className="flex items-start gap-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={inspection[item.id].positionConfirmed}
                        onChange={(event) =>
                          updateInspection(item.id, {
                            positionConfirmed: event.currentTarget.checked,
                          })
                        }
                      />
                      도면의 측정 위치와 위 검사 기준을 확인했습니다.
                      이 기준을 작업자 판정에 적용합니다.
                    </label>
                  </div>
                )}

                {dim && (
                  <label className="block space-y-1 text-xs">
                    <span>치수 표기 · 예: ⌀12±0.01, M10, C0.5</span>
                    <input
                      className={inputClass}
                      value={dimensions[dim.item_id] ?? dim.text}
                      onChange={(event) => {
                        setDimensions((previous) => ({
                          ...previous,
                          [dim.item_id]: event.target.value,
                        }));
                        invalidate(item.id);
                      }}
                    />
                  </label>
                )}

                {rows.map((row) => (
                  <div key={row.item_id} className="space-y-2 border-t pt-2">
                    <p className="text-xs">
                      {row.item_id} · {row.symbol_name || row.symbol}
                    </p>
                    {row.status === "format_error" && (
                      <p className="text-xs text-amber-800">{row.message}</p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {(["symbol", "value", "datums"] as const).map((field) => (
                        <label key={field} className="space-y-1 text-xs">
                          <span>
                            {field === "symbol"
                              ? "기호"
                              : field === "value"
                                ? "공차값"
                                : "데이텀(A, B)"}
                          </span>
                          <input
                            className={inputClass}
                            value={
                              gdt[row.item_id]?.[field] ??
                              (field === "datums"
                                ? row.datums.join(", ")
                                : field === "symbol"
                                  ? row.symbol
                                  : row.value)
                            }
                            onChange={(event) =>
                              updateGdt(
                                item.id,
                                row.item_id,
                                field,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <details
          open
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"
        >
          <summary className="cursor-pointer text-sm font-bold text-slate-800">
            + 치수 추가
            <span className="ml-1 text-xs font-normal text-slate-500">
              OCR이 놓친 치수 보충
            </span>
          </summary>
          <p className="text-xs text-slate-600">
            표기를 입력하고 원본 이미지 픽셀 기준 위치를 지정해주세요.
          </p>

          {added.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-2">
              <input
                aria-label="추가 치수 표기"
                className={inputClass}
                placeholder="예: 26±0.05, ⌀12, R3, C0.5, M10"
                value={item.text}
                onChange={(event) =>
                  updateAdded(item.id, { text: event.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="추가 치수 X 좌표"
                  className={inputClass}
                  placeholder="X 좌표"
                  value={item.x}
                  onChange={(event) =>
                    updateAdded(item.id, { x: event.target.value })
                  }
                />
                <input
                  aria-label="추가 치수 Y 좌표"
                  className={inputClass}
                  placeholder="Y 좌표"
                  value={item.y}
                  onChange={(event) =>
                    updateAdded(item.id, { y: event.target.value })
                  }
                />
              </div>
                            <div className="space-y-3">
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {item.x.trim() && item.y.trim()
                    ? `선택 위치: X ${item.x} · Y ${item.y}`
                    : "아직 위치를 선택하지 않았습니다."}
                </div>

                <div className="flex flex-wrap gap-2">
                  {onPickPosition && (
                    <button
                      type="button"
                      onClick={() => void pickPosition(item.id)}
                      className="rounded-lg border border-cyan-600 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 transition hover:bg-cyan-100"
                    >
                      ① 도면에서 위치 선택
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => confirmAddedPosition(item)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                      item.positionConfirmed
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-cyan-700 text-white hover:bg-cyan-800"
                    }`}
                  >
                    {item.positionConfirmed
                      ? "✓ 측정 위치 확정됨"
                      : "② 측정 위치 확정"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setAdded((previous) =>
                        previous.filter((entry) => entry.id !== item.id),
                      )
                    }
                    className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700"
                  >
                    추가 취소
                  </button>
                </div>

                {item.positionConfirmed && (
                  <p className="text-xs text-emerald-700">
                    위치를 확정했습니다. 최종 서버 저장은 아래의
                    「검토 완료 및 서버 저장」을 눌러주세요.
                  </p>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            className="rounded border px-3 py-1 text-xs"
            onClick={() =>
              setAdded((previous) => [
                ...previous,
                { id: crypto.randomUUID(), text: "", x: "", y: "" },
              ])
            }
          >
            + 치수 추가
          </button>
        </details>

        {error && (
          <p
            role="alert"
            className="whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-700"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={saving || picking}
          onClick={() => void save()}
          className="w-full rounded bg-cyan-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {saving ? "서버 저장 중…" : "검토 완료 및 서버 저장"}
        </button>
      </fieldset>

      {picking && (
        <p role="status" className="text-xs text-cyan-800">
          도면에서 위치를 선택해주세요.
        </p>
      )}
    </section>
  );
}