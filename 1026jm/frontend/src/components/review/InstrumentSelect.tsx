import { useEffect, useState } from "react";
import { ALL_INSTRUMENTS } from "../../lib/inspection/instruments";

const OTHER = "__other__";

interface Props {
  value: string;
  onChange: (value: string) => void;
  recommended: string[];
  id?: string;
  className?: string;
}

/** 추천 측정기 → 전체 목록 → 기타(직접 입력) 순서의 선택 상자. */
export default function InstrumentSelect({ value, onChange, recommended, id, className }: Props) {
  const known = recommended.includes(value) || ALL_INSTRUMENTS.includes(value);
  const [other, setOther] = useState(!!value && !known);

  useEffect(() => {
    if (value && !recommended.includes(value) && !ALL_INSTRUMENTS.includes(value)) setOther(true);
  }, [value, recommended]);

  const rest = ALL_INSTRUMENTS.filter((name) => !recommended.includes(name));
  const selectValue = other ? OTHER : value;

  return (
    <div className="space-y-1.5">
      <select
        id={id}
        className={className}
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === OTHER) {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(next);
          }
        }}
      >
        <option value="">측정기를 선택해주세요</option>
        {recommended.length > 0 && (
          <optgroup label="추천">
            {recommended.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={recommended.length ? "그 밖의 측정기" : "측정기"}>
          {rest.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
        <option value={OTHER}>기타 (직접 입력)</option>
      </select>
      {other && (
        <input
          aria-label="측정기 직접 입력"
          className={className}
          placeholder="측정기 이름을 입력하세요"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
