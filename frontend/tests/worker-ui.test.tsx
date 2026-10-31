import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { caseTextBlocks } from '../src/lib/casePresentation';
import { ManufacturingPage } from '../src/pages/ManufacturingPage';
import { AssemblyPage } from '../src/pages/AssemblyPage';
import { VerificationPage } from '../src/pages/VerificationPage';
import { WorkerErrorPanel } from '../src/components/worker/WorkerErrorPanel';
import { UnsavedChangesProvider } from '../src/lib/unsavedChanges';
import { toOcrPoints, type OcrDocument } from '../src/lib/ocr';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:3000' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
let narrow = false;
(dom.window as any).matchMedia = () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} });
const doc: OcrDocument = { drawing_id: 'test-drawing', review_status: 'reviewed', part_name: '피스톤 로드', image: { width_px: 1200, height_px: 800 }, items: [1, 2].map(n => ({ id: 'item-'+n, category: 'DIMENSION', raw_text: String(75+n), position: { x: n*100, y: 100 }, measurement_characteristic: 'LINEAR_DIMENSION', feature_type: 'PLANE', nominal_value: 75+n, unit: 'mm', lower_limit: 74.7+n, upper_limit: 75.3+n, inspection_approved: true, measurement_mode: 'numeric', instrument: '버니어 캘리퍼스' })) };
const points = toOcrPoints(doc);
const drawing: any = { drawing_id: doc.drawing_id, part_id: 'part', original_filename: 'test.pdf', media_type: 'application/pdf' };
const registry = new Set<string>();
const requests: { path: string; method: string }[] = [];
const example = { case_id: 'case-1', case_title: '기준면 오염으로 인한 측정 오류', precaution: '{"condition":"측정 전 영점 확인","step":["기준면 청소","측정 위치 확인"]}', cause: '기준면에 이물질 잔류', error_description: '실측값이 크게 나옴', corrective_action: '청소 후 재측정', source_file: 'sample.xlsx', distance: 0.1 };
function mockFetch() {
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname+url.search, method: options.method ?? 'GET' });
    let body: any;
    if (url.pathname.endsWith('/errors')) body = { drawing_id: doc.drawing_id, item_id: url.pathname.split('/').at(-2), revision: 'rev-1', errors: [example], ...(url.searchParams.has('stage') ? { stage: url.searchParams.get('stage') } : {}) };
    else if (url.pathname.endsWith('/error-cases')) body = { reports: [] };
    else if (url.pathname.endsWith('/measurements')) body = { records: [] };
    else if (url.pathname.endsWith('/plan')) body = { drawing_id: doc.drawing_id, revision: 'rev-1', serial: url.searchParams.get('serial') || 'PR01', serials: ['PR01'], stage_labels: { '1': '황삭', '2': '중삭', '3': '정삭' }, template_found: true, items: points.map(p => ({ item_id: p.source.id, raw_text: p.source.raw_text, label: p.feature.name, plan_label: '정삭', stages: { '1': { role: 'finish', mode: 'numeric', target: 76, allowance: 0, lower_limit: 75.7, upper_limit: 76.3, text: '검사 기준' }, '2': null, '3': null } })), records: [], status: { '1': { unlocked: true, required: 2, passed: 0, failed: 0 }, '2': { unlocked: false, required: 0, passed: 0, failed: 0 }, '3': { unlocked: false, required: 0, passed: 0, failed: 0 } } };
    else throw new Error(`Unexpected request: ${url.pathname}`);
    return new Response(JSON.stringify(body), { status: 200 });
  };
}
let root: Root;
async function mount(element: React.ReactNode) {
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(element); });
}
async function unmount() { await act(async () => root.unmount()); document.getElementById('root')!.replaceChildren(); }
function Fixture({ Page, readOnly = false }: { Page: typeof AssemblyPage; readOnly?: boolean }) {
  const [id, setId] = useState(1);
  return <UnsavedChangesProvider registry={registry}><Page demoMode={false} selectedDrawing={drawing} document={doc} ocrStatus="ready" ocrStage="" revision="rev-1" resultUrl="/drawing.png" ocrPoints={points} filteredOcrPoints={points} activeOcrPoint={points.find(p=>p.id===id)} onSelectOcrPoint={setId} onNavigateOcr={delta=>setId(id===1?2:1)} ocrInspectionRecords={{}} measurementRecords={{}} onMeasurementSaved={()=>{}} readOnly={readOnly} workerBlocked={false} demo={{} as any} /></UnsavedChangesProvider>;
}

test('구조화 문자열을 읽기 쉬운 필드로 변환하며 치수·단위·공정 태그 보존', () => {
  assert.deepEqual(caseTextBlocks('[황삭] 74.7 ~ 75.3 mm'), [{ label: '', text: '[황삭] 74.7 ~ 75.3 mm' }]);
  assert.deepEqual(caseTextBlocks('{"cause":"오염","corrective_action":["청소","재측정"],"criteria":{"value":0,"unit":"mm"}}'), [
    { label: '원인', text: '오염' }, { label: '조치', text: '청소' }, { label: '조치', text: '재측정' }, { label: '기준 · 값', text: '0' }, { label: '기준 · 단위', text: 'mm' },
  ]);
  assert.deepEqual(caseTextBlocks(undefined), []);
});

test('세 업무: 측정은 왼쪽, 기존 도면·표는 가운데, 오류·등록은 오른쪽', async t => {
  for (const [purpose, Page] of [['manufacturing', ManufacturingPage], ['assembly', AssemblyPage], ['verification', VerificationPage]] as const) {
    await t.test(purpose, async () => {
      narrow = false; requests.length = 0; mockFetch();
      await mount(<Fixture Page={Page} />);
      try {
        const left = document.querySelector('.worker-measurement')!;
        const center = document.querySelector('.worker-center')!;
        const support = document.querySelector('.worker-support')!;
        const entry = left.querySelector('[aria-label$="측정 입력"]')!;
        assert.ok(entry);
        const criteria = Array.from(left.querySelectorAll('details.worker-disclosure')).find(el => /^(상세 검사 기준|가공·검사 기준)$/.test(el.querySelector('summary')?.textContent ?? ''))!;
        assert.ok(criteria);
        assert.equal(criteria.hasAttribute('open'), false);
        assert.ok(entry.compareDocumentPosition(criteria) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
        const caseDetails = support.querySelector('details.worker-case-details')!;
        assert.equal(caseDetails.hasAttribute('open'), false);
        assert.ok(caseDetails.textContent!.includes(example.cause));
        assert.equal(caseDetails.textContent!.includes(example.corrective_action), false);
        assert.ok(center.querySelector('.worker-table-basis'));
        assert.equal(left.querySelector('[aria-label="이 포인트의 오류 기록"]'), null);
        assert.equal(left.textContent!.includes(example.cause), false);
        assert.equal(center.querySelectorAll('tbody tr').length, 2);
        assert.ok(center.querySelector('[aria-label="도면 조작 모드"]'));
        assert.ok(support.textContent!.includes('측정 전 영점 확인'));
        assert.ok(support.textContent!.includes('청소 후 재측정'));
        assert.ok(support.querySelector('[aria-label="이 포인트의 오류 기록"]'));
        assert.ok(!support.textContent!.includes('"condition"'));
        const errors = requests.filter(r=>r.path.includes('/errors'));
        assert.ok(errors.some(r=>purpose==='manufacturing' ? r.path.includes('/api/machining/')&&r.path.includes('stage=1') : r.path.includes(`/purposes/${purpose}/`)));
        assert.ok(requests.every(r=>r.method==='GET'));
        await act(async()=>{(center.querySelector('tr[data-point="2"]') as HTMLElement).click();});
        assert.ok(support.querySelector('[aria-label="오류 사례 선택 항목"]')!.textContent!.includes('2번'));
        assert.equal(center.querySelector('tr[aria-selected="true"]')?.getAttribute('data-point'), '2');
      } finally { await unmount(); }
    });
  }
});

test('조회 전용 유지, 좁은 화면 패널 열기·닫기 시 측정 입력 DOM 보존', async () => {
  narrow = true; mockFetch();
  await mount(<Fixture Page={AssemblyPage} readOnly />);
  try {
    const support = document.querySelector('.worker-support') as HTMLElement;
    assert.equal(support.inert, true);
    const input = document.querySelector('.worker-measurement input[placeholder="측정한 값을 입력하세요"]')!;
    assert.ok((input.closest('fieldset') as HTMLFieldSetElement).disabled);
    const toggle = document.querySelector('.worker-support-toggle') as HTMLButtonElement;
    await act(async()=>toggle.click());
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(support.inert, false);
    assert.equal(support.querySelector('button')?.getAttribute('aria-label'), '오류 사례 패널 닫기');
    assert.ok(!Array.from(support.querySelectorAll('button')).some(b=>b.textContent==='오류사례 등록'));
    await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key:'Escape' })));
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('.worker-measurement input[placeholder="측정한 값을 입력하세요"]'), input);
  } finally { await unmount(); narrow = false; }
});

test('늦게 도착한 이전 항목 오류 응답이 현재 항목을 덮어쓰지 않음', async () => {
  const pending = new Map<string, (r: Response) => void>();
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/error-cases')) return new Response('{"reports":[]}');
    return new Promise(resolve => pending.set(path.split('/').at(-2)!, resolve));
  };
  const render = (index: number) => <WorkerErrorPanel purpose="assembly" drawingId={doc.drawing_id} revision="rev-1" point={points[index]} readOnly />;
  await mount(render(0));
  try {
    await act(async()=>root.render(render(1)));
    const respond = (id:string,title:string)=>pending.get(id)!(new Response(JSON.stringify({drawing_id:doc.drawing_id,item_id:id,revision:'rev-1',errors:[{...example,case_title:title}]})));
    await act(async()=>respond('item-2','현재 항목 사례'));
    await act(async()=>respond('item-1','이전 항목 사례'));
    assert.ok(document.body.textContent!.includes('현재 항목 사례'));
    assert.ok(!document.body.textContent!.includes('이전 항목 사례'));
  } finally { await unmount(); }
});

test('오른쪽 너비 조절: 드래그·방향키·기본값 복원·너비 저장, 치수 표 유지', async () => {
  narrow = false; mockFetch(); localStorage.removeItem('dx.worker-support-width');
  const proto = dom.window.HTMLElement.prototype as any;
  proto.setPointerCapture = () => {};
  proto.hasPointerCapture = () => true;
  proto.releasePointerCapture = () => {};
  await mount(<Fixture Page={AssemblyPage} />);
  try {
    const divider = document.querySelector('[aria-label="도면과 오류 사례 너비 조절"]') as HTMLElement;
    const width = () => Number(divider.getAttribute('aria-valuenow'));
    assert.equal(width(), 340);
    await act(async()=>divider.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'ArrowLeft',bubbles:true})));
    assert.equal(width(), 356);
    const pointer = (type:string,x:number) => {
      const event = new dom.window.MouseEvent(type,{clientX:x,button:0,bubbles:true});
      Object.defineProperty(event,'pointerId',{value:1});
      divider.dispatchEvent(event);
    };
    await act(async()=>pointer('pointerdown',900));
    await act(async()=>pointer('pointermove',850));
    assert.equal(width(), 406);
    await act(async()=>pointer('pointerup',850));
    assert.equal(localStorage.getItem('dx.worker-support-width'),'406');
    await act(async()=>divider.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true})));
    assert.equal(width(),Number(divider.getAttribute('aria-valuemax')));
    await act(async()=>divider.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true})));
    assert.equal(width(),Number(divider.getAttribute('aria-valuemin')));
    await act(async()=>divider.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true})));
    assert.equal(width(),340);
    assert.equal(document.querySelectorAll('.worker-center tbody tr').length,2);
  } finally { await unmount(); }
});
