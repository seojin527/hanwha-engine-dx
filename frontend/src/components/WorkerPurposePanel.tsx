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
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 p-2">
        <div
          role="group"
          aria-label="작업 목적 선택"
          className="flex overflow-hidden rounded border border-slate-300"
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={purpose === tab.value}
              onClick={() => setPurpose(tab.value)}
              className={`flex-1 px-3 py-2 text-xs font-bold transition ${
                purpose === tab.value
                  ? "bg-cyan-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
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