/** Convert structured case text to readable blocks without changing its technical values. */
export interface CaseTextBlock { label: string; text: string }
const LABELS: Record<string, string> = {
  cause: '원인', precaution: '주의사항', corrective_action: '조치', action: '조치',
  error_description: '발생 오류', description: '내용', detail: '상세', message: '설명',
  applicable_condition: '적용 조건', exclude_condition: '제외 조건', condition: '조건',
  recommended_instrument: '측정기', instrument: '측정기', severity: '심각도',
  impact: '영향', process_stage: '공정', step: '순서', title: '제목', value: '값',
  unit: '단위', note: '참고', warning: '주의', tolerance: '공차', criteria: '기준',
};
export function caseTextBlocks(value: unknown): CaseTextBlock[] {
  const result: CaseTextBlock[] = [];
  const visit = (input: unknown, label: string, depth: number) => {
    if (input === null || input === undefined || depth > 12) return;
    if (typeof input === 'string') {
      const text = input.trim();
      if (!text) return;
      if (/^[\[{]/.test(text)) {
        try { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === 'object') { visit(parsed, label, depth + 1); return; } } catch { /* e.g. [황삭] is plain text */ }
      }
      result.push({ label, text });
    } else if (Array.isArray(input)) input.forEach(entry => visit(entry, label, depth + 1));
    else if (typeof input === 'object') Object.entries(input).forEach(([key, entry]) => {
      const name = LABELS[key] ?? key.replace(/_/g, ' ');
      visit(entry, label ? `${label} · ${name}` : name, depth + 1);
    });
    else result.push({ label, text: String(input) });
  };
  visit(value, '', 0);
  return result;
}
