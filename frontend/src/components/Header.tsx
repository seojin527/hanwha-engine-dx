/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Search } from "lucide-react";
import { MOCK_PART_INFO } from "../data/mockData";

interface HeaderProps {
  displayInfo?: { partName: string; drawingName: string };
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

/** 상단 제품 헤더: 제품명 · 현재 부품/도면 정보 · 검색 · 사용자. 작업 버튼은 아래 작업 툴바에 둔다. */
export const Header: React.FC<HeaderProps> = ({
  displayInfo,
  searchQuery,
  onSearchChange,
}) => {
  const meta = [
    { label: "부품", value: displayInfo?.partName || MOCK_PART_INFO?.name },
    { label: "부품번호", value: displayInfo ? "—" : MOCK_PART_INFO?.partNo },
    { label: "도면", value: displayInfo?.drawingName || MOCK_PART_INFO?.drawingNo },
    { label: "축척", value: displayInfo ? "—" : MOCK_PART_INFO?.scale },
    { label: "개정", value: displayInfo ? "—" : MOCK_PART_INFO?.revision },
  ];

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-950 px-4 text-white">
      <div className="flex min-w-0 shrink-0 items-baseline gap-2">
        <h1 className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-white">
          도면 측정 가이드
        </h1>
        <span className="hidden whitespace-nowrap text-[11px] text-slate-500 xl:inline">
          엔진 부품 품질검사
        </span>
      </div>

      <dl className="hidden min-w-0 flex-1 items-center gap-x-4 overflow-hidden border-l border-slate-800 pl-4 text-xs lg:flex">
        {meta.map(({ label, value }, index) => (
          <div
            key={label}
            className={`flex min-w-0 items-baseline gap-1.5 ${index >= 3 ? "hidden 2xl:flex" : ""}`}
          >
            <dt className="shrink-0 text-slate-500">{label}</dt>
            <dd className="truncate font-medium text-slate-200">{value || "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <label className="relative block">
          <span className="sr-only">측정항목 검색</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            placeholder="번호·규격 검색"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="field-dark h-7 w-36 pl-7 sm:w-44"
          />
        </label>

        <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">
            김
          </div>
          <div className="hidden text-left leading-tight sm:block">
            <div className="text-xs font-medium text-slate-200">김태호</div>
            <div className="text-[10px] text-slate-500">QA Lead</div>
          </div>
        </div>
      </div>
    </header>
  );
};
