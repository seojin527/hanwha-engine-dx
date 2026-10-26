import { useState, type ComponentProps } from "react";
import { ManufacturingPanel } from "./ManufacturingPanel";
import { AssemblyPanel } from "./AssemblyPanel";
import { VerificationPanel } from "./VerificationPanel";

type Props = ComponentProps<typeof ManufacturingPanel>;

type Purpose = "manufacturing" | "assembly" | "verification";

const tabs: { value: Purpose; label: string }[] = [
  { value: "manufacturing", label: "부품제작" },
  { value: "assembly", label: "조립" },
  { value: "verification", label: "검증" },
];

export function WorkerPurposePanel(props: Props) {
  const [purpose, setPurpose] = useState<Purpose>("manufacturing");

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="shrink-0 text-[11px] font-medium text-slate-500">작업 목적</span>
        <div
          role="group"
          aria-label="작업 목적 선택"
          className="seg min-w-0 flex-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={purpose === tab.value}
              onClick={() => setPurpose(tab.value)}
              className="seg-item"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div hidden={purpose !== "manufacturing"}>
          <ManufacturingPanel {...props} />
        </div>

        <div hidden={purpose !== "assembly"}>
          <AssemblyPanel {...props} />
        </div>

        <div hidden={purpose !== "verification"}>
          <VerificationPanel {...props} />
        </div>
      </div>
    </div>
  );
}