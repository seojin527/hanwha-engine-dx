import { ManufacturingTask } from '../src/components/mobile/MobileTask';
import OcrMeasurementEntry from '../src/components/OcrMeasurementEntry';
import { CaseCard } from '../src/components/worker/WorkerErrorPanel';
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
// React loads before JSDOM globals in this runner and selects its legacy input-event fallback.
(dom.window.HTMLElement.prototype as any).attachEvent = () => {};
(dom.window.HTMLElement.prototype as any).detachEvent = () => {};
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
    if (url.pathname.endsWith('/errors')) body = { drawing_id: doc.drawing_id, item_id: url.pathname.split('/').at(-2), revision: 'rev-1', errors: [example, { ...example, case_id: "case-2", case_title: "다른 측정 사례", precaution: "두 번째 사례 주의사항" }], ...(url.searchParams.has('stage') ? { stage: url.searchParams.get('stage') } : {}) };
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
        assert.ok(support.querySelector('[aria-label="오류와 발생 원인"]')!.textContent!.includes(example.cause));
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


test('사례 목록에서 하나만 표시하고 사례 변경 시 측정 입력을 유지', async () => {
  narrow = false; mockFetch();
  await mount(<Fixture Page={AssemblyPage} />);
  try {
    const input = document.querySelector('.worker-measurement input[inputmode="decimal"]')!;
    const list = document.querySelector('[aria-label="참고 사례 목록"]')!;
    assert.equal(list.querySelectorAll('button').length, 2);
    assert.equal(document.querySelectorAll('.worker-case-card').length, 1);
    assert.ok(document.querySelector('.worker-case-card')!.textContent!.includes(example.precaution.includes('condition') ? '측정 전 영점 확인' : example.precaution));
    await act(async () => (list.querySelectorAll('button')[1] as HTMLButtonElement).click());
    assert.equal(list.querySelectorAll('[aria-pressed="true"]').length, 1);
    assert.ok(document.querySelector('.worker-case-card')!.textContent!.includes('두 번째 사례 주의사항'));
    assert.equal(document.querySelectorAll('.worker-case-card').length, 1);
    assert.equal(document.querySelector('.worker-measurement input[inputmode="decimal"]'), input);
  } finally { await unmount(); }
});


test('사례 가이드는 저장된 원인·조건·출처를 표시하고 누락된 설명을 생성하지 않음', async () => {
  await mount(<CaseCard error={{ ...example, applicable_condition: '도면에 지정된 기준면', exclude_condition: '다른 데이텀 지정 시 제외', data_origin: 'SYNTHETIC', corrective_action: '' }} />);
  try {
    const card = document.querySelector('[aria-label="선택한 사례 상세"]')!;
    assert.ok(card.textContent!.includes(example.cause));
    assert.ok(card.textContent!.includes('도면에 지정된 기준면'));
    assert.ok(card.textContent!.includes('다른 데이텀 지정 시 제외'));
    assert.ok(card.textContent!.includes('예시 데이터'));
    assert.ok(card.textContent!.includes(example.source_file));
    assert.equal(card.querySelector('[aria-label="오류 발생 시 조치"]')!.textContent!.includes('등록된 설명이 없습니다.'), true);
    assert.ok(card.querySelectorAll('[aria-label="측정 전 확인"] li').length > 0);
    assert.ok(!card.textContent!.includes('"condition"'));
  } finally { await unmount(); }
});


test('사례 탭은 내용 하나만 표시하고 키보드로 이동 가능', async () => {
  await mount(<CaseCard error={example} />);
  try {
    const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    assert.equal(tabs.length, 3);
    assert.equal(Array.from(panels).filter(p => !p.hidden).length, 1);
    assert.equal(panels[0].hidden, false);
    await act(async () => tabs[1].click());
    assert.equal(panels[0].hidden, true);
    assert.equal(panels[1].hidden, false);
    assert.ok(panels[1].textContent!.includes(example.corrective_action));
    await act(async () => tabs[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
    assert.equal(panels[2].hidden, false);
    assert.equal(document.activeElement, tabs[2]);
    assert.ok(panels[2].textContent!.includes(example.cause));
  } finally { await unmount(); }
});


test('확정 저장 후에도 기존 측정 메모와 재측정 버튼 유지', async () => {
  const record = { drawing_id: doc.drawing_id, revision: 'rev-1', item_id: 'item-1', work_purpose: 'assembly', confirmed: true, status: 'completed', judgement: 'pass', measured_value: '76', instrument: '버니어 캘리퍼스', note: '기존 메모' };
  globalThis.fetch = async () => new Response(JSON.stringify({ drawing_id: doc.drawing_id, revision: 'rev-1', work_purpose: 'assembly', records: [record] }));
  await mount(<UnsavedChangesProvider registry={registry}><OcrMeasurementEntry purpose="assembly" drawingId={doc.drawing_id} revision="rev-1" item={doc.items[0]} /></UnsavedChangesProvider>);
  try {
    assert.equal(document.querySelector('textarea')?.value, '기존 메모');
    assert.ok(Array.from(document.querySelectorAll('button')).some(b => b.textContent === '합격'));
  } finally { await unmount(); }
});

for (const mode of ['trial', 'save', 'view'] as const) {
  test(`모바일 제작 ${mode}: 단계 이동·저장 정책 유지`, async () => {
    mockFetch();
    const fetchMock = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      const response = await fetchMock(input, options);
      if (String(input).includes('/plan')) {
        const body = await response.json();
        for (const entry of body.items) entry.stages['2'] = entry.stages['3'] = entry.stages['1'];
        return new Response(JSON.stringify(body));
      }
      return response;
    };
    await mount(<ManufacturingTask purpose="manufacturing" mode={mode} partName="피스톤 로드" drawing={drawing} document={doc} revision="rev-1" resultUrl={null} points={points} activePoint={points[0]} onSelectPoint={() => {}} measurementRecords={{}} onMeasurementSaved={() => {}} trial={{}} onTrial={() => { throw new Error('단계 이동은 측정값을 만들면 안 됨'); }} onBack={() => {}} onExports={() => {}} />);
    try {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="가공 단계"] button'));
      const stageButtons = buttons.length ? buttons : Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(b => /^(황삭|중삭|정삭)/.test(b.textContent ?? ''));
      assert.equal(stageButtons.length, 3);
      assert.equal(stageButtons[1].disabled, false);
      assert.equal(stageButtons[2].disabled, false);
      await act(async () => stageButtons[1].click());
      assert.equal(stageButtons[1].getAttribute('aria-pressed'), 'true');
      await act(async () => stageButtons[2].click());
      assert.equal(stageButtons[2].getAttribute('aria-pressed'), 'true');
      if (mode === 'trial') {
        assert.ok(document.body.textContent?.includes('체험 모드'));
        assert.equal(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked, false);
      }
      assert.ok(requests.every(r => r.method === 'GET'));
    } finally { await unmount(); }
  });
}

// Regression: opening a drawing must stay inside the site, without navigating to a raw PDF.
import { DrawingPreview } from '../src/components/drawings/DrawingParts';
import { DrawingViewer } from '../src/components/DrawingViewer';
import { MobileShell, type MobileShellProps } from '../src/components/mobile/MobileShell';
import { LoginScreen } from '../src/components/entry/LoginScreen';

const pdfDrawing = { ...drawing, original_filename: '피스톤 도면.pdf', file_url: '/api/drawings/test-drawing/file', media_type: 'application/pdf', size_bytes: 1024, created_at: '2026-11-08T08:00:00', ocr_status: 'ready', review_status: 'reviewed' };

test('PDF 도면 미리보기는 새 탭·파일 다운로드 대신 사이트 안 PNG 확대 창을 연다', async () => {
  (dom.window.HTMLDialogElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  let selected = '';
  await mount(<DrawingPreview drawing={pdfDrawing} onStart={d => { selected = d.drawing_id; }} />);
  try {
    assert.equal(document.querySelector('a[href*="/file"]'), null);
    await act(async () => (document.querySelector('button[title="도면 확대 보기"]') as HTMLButtonElement).click());
    const dialog = document.querySelector('dialog[open]')!;
    assert.ok(dialog);
    assert.equal(dialog.querySelector('iframe'), null);
    assert.ok(dialog.querySelector('img[src*="/thumbnail?size=lg"]'));
    await act(async () => (dialog.querySelector('[aria-label="도면 미리보기 닫기"]') as HTMLButtonElement).click());
    assert.equal(document.querySelector('dialog'), null);
    await act(async () => (Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('작업 시작')) as HTMLButtonElement).click());
    assert.equal(selected, pdfDrawing.drawing_id);
  } finally { await unmount(); }
});

test('PDF 원본의 썸네일을 측정창에 전달하면 PDF iframe 대신 이미지로 표시한다', async () => {
  await mount(<DrawingViewer drawingUrl="http://127.0.0.1:3000/api/drawings/test-drawing/thumbnail?size=lg" mediaType="application/pdf" points={[]} selectedPointId={0} onSelectPoint={() => {}} inspectionRecords={{}} isAnalyzing={false} analyzingStep={0} />);
  try {
    assert.equal(document.querySelector('iframe'), null);
    assert.ok(document.querySelector('img[src*="/thumbnail?size=lg"]'));
  } finally { await unmount(); }
});

const mobileProps: MobileShellProps = { userLabel: '관리자', roleText: '관리자', isAdmin: true, trial: false, ownPurpose: null, onLogout() {}, inWorkspace: false, engineModel: null, onEngineReady() {}, selection: { engineKey: null, partId: null, drawingId: null }, onSelect() {}, onOpenDrawing() {}, onBackTo3D() {}, selectedDrawing: null, siblingDrawings: [], document: null, ocrStatus: 'idle', resultUrl: null, points: [], onSelectPoint() {}, purpose: 'manufacturing', onPurpose() {}, measurementRecords: {}, onMeasurementSaved() {}, reviewFiles: [], reviewPane: null, picking: false, onPickAt() {}, onCancelPick() {} };

test('휴대폰 관리자 메뉴에서 도면 관리·엑셀 오류 DB·작업 현황으로 이동한다', async () => {
  globalThis.fetch = async () => new Response('{"parts":[]}');
  for (const [label, expected] of [['부품·도면 관리', 'library'], ['오류 DB 관리', 'errors'], ['작업 진행 현황', 'progress']]) {
    let target = '';
    await mount(<MobileShell {...mobileProps} onNavigateAdmin={view => { target = view; }} />);
    try {
      await act(async () => (document.querySelector('[aria-label="메뉴"]') as HTMLButtonElement).click());
      const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(label))!;
      assert.ok(button);
      await act(async () => button.click());
      assert.equal(target, expected);
    } finally { await unmount(); }
  }
});

test('일반 접속자가 관리자 역할을 고르면 DB와 작업 현황을 조회한다', async () => {
  dom.reconfigure({ url: 'https://dx.165-245-178-152.sslip.io/' });
  globalThis.fetch = async () => new Response('{"parts":[]}');
  let target = '';
  await mount(<MobileShell {...mobileProps} isAdmin trial onNavigateAdmin={view => { target = view; }} />);
  try {
    await act(async () => (document.querySelector('[aria-label="메뉴"]') as HTMLButtonElement).click());
    assert.equal(document.querySelector('a'), null);
    assert.ok(document.body.textContent?.includes('조회 전용'));
    assert.ok(!document.body.textContent?.includes('부품·도면 관리'));
    await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('오류 DB 조회'))!.click());
    assert.equal(target, 'errors');
  } finally { await unmount(); dom.reconfigure({ url: 'http://127.0.0.1:3000' }); }
});

test('로그인에서 데모 진입을 제거하고 공개 화면은 기존 관리자 인증 주소로 연결한다', async () => {
  dom.reconfigure({ url: 'https://dx.165-245-178-152.sslip.io/' });
  await mount(<LoginScreen visitor compact onLogin={() => {}} />);
  try {
    assert.ok(!document.body.textContent?.includes('데모 도면'));
    assert.equal(document.querySelector('a')?.textContent, '관리자 페이지');
    assert.equal(document.querySelector('a')?.href, 'https://dx.165-245-178-152.sslip.io/admin-login');
  } finally { await unmount(); dom.reconfigure({ url: 'http://127.0.0.1:3000' }); }
});

import { AdminLoginScreen } from '../src/components/entry/AdminLoginScreen';
import { ShellRail } from '../src/components/shell/ShellChrome';

test('태블릿 관리자 진입은 브라우저 인증 팝업 대신 아이디·비밀번호 입력 화면을 제공한다', async () => {
  await mount(<AdminLoginScreen />);
  try {
    assert.equal(document.querySelector('input[autocomplete="username"]')?.getAttribute('type'), null);
    assert.equal((document.querySelector('input[autocomplete="username"]') as HTMLInputElement).value, 'admin');
    assert.equal((document.querySelector('input[type="password"]') as HTMLInputElement).value, '');
    assert.ok(document.querySelector('button[type="submit"]'));
    assert.equal(document.querySelector('a')?.getAttribute('href'), '/');
  } finally { await unmount(); }
});

test('작업자 역할에는 DB와 작업 현황 메뉴를 표시하지 않는다', async () => {
  await mount(<ShellRail view="engine" isAdmin={false} drawingAvailable={false} onNavigate={() => {}} onLogout={() => {}} />);
  try {
    assert.equal(document.querySelector('a'), null);
    assert.equal(document.querySelector('[aria-label="관리자 · 오류 DB 조회"]'), null);
    assert.equal(document.querySelector('[aria-label="작업 진행 현황"]'), null);
    assert.equal(document.querySelector('[aria-label="관리자 페이지"]'), null);
  } finally { await unmount(); }
});

import DrawingReviewPanel from '../src/components/DrawingReviewPanel';

test('관리자 검토는 치수와 검사 기준을 함께 유지하고 긴 안내는 펼쳐 확인한다', async () => {
  const reviewItems = doc.items.map((item, index) => ({ ...item, id: `dimension_${index + 1}`, raw_text: `${item.nominal_value}±0.3` }));
  const source = { drawing_id: doc.drawing_id, revision: 'rev-1', result: { ...doc, items: reviewItems, review_status: 'unreviewed' as const }, review: { gdt: [], dimensions: reviewItems.map((item, index) => ({ item_id: item.id, no: index + 1, text: `${item.nominal_value}±0.3`, position: item.position, position_image: item.position })), warnings: ['도면 원본의 공차를 확인해주세요.'] } };
  await mount(<UnsavedChangesProvider registry={registry}><DrawingReviewPanel source={source} onSaved={() => {}} defaultReviewer="관리자" selectedItemId="dimension_1" imageUrl="/drawing.png" /></UnsavedChangesProvider>);
  try {
    const pair = document.querySelector('.review-pair')!;
    assert.ok(pair.textContent?.includes('치수 확인'));
    assert.ok(pair.textContent?.includes('작업자 검사 기준'));
    assert.ok(pair.querySelector('input'));
    assert.ok(pair.querySelector('select'));
    const guidance = document.querySelector<HTMLDetailsElement>('details.review-guidance')!;
    assert.equal(guidance.open, false);
    assert.ok(guidance.querySelector('summary')?.textContent?.includes('경고 1건'));
    await act(async () => guidance.querySelector('summary')!.click());
    assert.equal(guidance.open, true);
    assert.ok(guidance.textContent?.includes('도면 원본의 공차를 확인해주세요.'));
    assert.ok(document.querySelector('button[type="button"]'));
  } finally { await unmount(); }
});

import { EvaluationRoleSelect, EvaluationSessionFrame } from '../src/components/entry/EvaluationRoles';

test('관리자 인증 후 네 역할을 선택하며 역할 전환에는 인증 요청을 다시 보내지 않는다', async () => {
  const selected: string[] = [];
  globalThis.fetch = async () => { assert.fail('role selection must not submit credentials again'); };
  await mount(<EvaluationRoleSelect onSelect={(name, role) => { assert.equal(name, '평가자'); selected.push(role.kind === 'admin' ? 'admin' : role.purpose); }} onSignOut={() => {}} />);
  try {
    const choices = document.querySelectorAll<HTMLButtonElement>('[aria-label="평가 역할 선택"] button');
    assert.equal(choices.length, 4);
    assert.ok(document.body.textContent?.includes('가공 작업자'));
    assert.ok(document.body.textContent?.includes('조립 검수자'));
    assert.ok(document.body.textContent?.includes('검증 검수자'));
    for (const button of choices) await act(async () => button.click());
    assert.deepEqual(selected, ['admin', 'manufacturing', 'assembly', 'verification']);
  } finally { await unmount(); }
});

test('역할 전환과 인증 종료는 별도 버튼으로 모든 인증 작업 화면 위에 제공한다', async () => {
  let switched = 0, signedOut = 0;
  await mount(<EvaluationSessionFrame role={{ kind: 'worker', purpose: 'assembly' }} onSwitch={() => { switched++; }} onSignOut={() => { signedOut++; }}><div>작업 화면</div></EvaluationSessionFrame>);
  try {
    const bar = document.querySelector('[aria-label="평가자 역할 전환"]')!;
    assert.ok(bar.textContent?.includes('조립'));
    const buttons = bar.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => buttons[0].click());
    assert.equal(switched, 1); assert.equal(signedOut, 0);
    await act(async () => buttons[1].click());
    assert.equal(signedOut, 1);
    assert.ok(document.querySelector('.evaluation-content')?.textContent?.includes('작업 화면'));
  } finally { await unmount(); }
});

test('저장된 검토자 이름은 현재 검토 입력에 복사하지 않고 공차 선택·수정 기능은 유지한다', async () => {
  const item = { ...doc.items[0], id: 'dimension_1', raw_text: '76±0.3' };
  const source = { drawing_id: doc.drawing_id, revision: 'rev-1', result: { ...doc, reviewer: 'Claude (마서진 요청)', items: [item], review_status: 'reviewed' as const }, review: { gdt: [], dimensions: [{ item_id: item.id, no: 1, text: item.raw_text, position: item.position, position_image: item.position }], warnings: [] } };
  await mount(<UnsavedChangesProvider registry={registry}><DrawingReviewPanel source={source} onSaved={() => {}} defaultReviewer="평가자" selectedItemId={item.id} imageUrl="/drawing.png" /></UnsavedChangesProvider>);
  try {
    assert.ok(!document.body.textContent?.includes('저장된 검토 ·'));
    assert.ok(!document.body.textContent?.includes('Claude'));
    assert.equal((document.querySelector('[aria-label="검토자"]') as HTMLInputElement).value, '평가자');
    assert.ok(document.querySelector('[aria-label="치수 표기"]'));
    const tolerance = document.querySelector<HTMLSelectElement>('[aria-label="공차 출처"]')!;
    assert.ok(tolerance);
    await act(async () => { tolerance.value = 'special'; tolerance.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.ok(Array.from(document.querySelectorAll('input')).some(input => input.placeholder === '예: +0.05'));
    assert.ok(Array.from(document.querySelectorAll('input')).some(input => input.placeholder === '예: -0.02'));
    assert.equal(Array.from(document.querySelectorAll('button')).filter(b => b.textContent === '검토 완료 및 서버 저장').length, 1);
  } finally { await unmount(); }
});

test('공개 로그인에는 빈 파란 안내 박스와 비활성 비밀번호 칸을 두지 않는다', async () => {
  await mount(<LoginScreen visitor onLogin={() => {}} />);
  try {
    assert.equal(document.querySelector('#login-password'), null);
    assert.equal(document.querySelector('p[class*="bg-cyan-300"]'), null);
    assert.ok(document.querySelector('#login-account'));
    assert.ok(document.querySelector('#login-role'));
  } finally { await unmount(); }
});

import { AdminReadOnlyContext } from '../src/lib/adminReadOnly';
import { ErrorDbManager } from '../src/components/admin/errorDb/ErrorDbManager';
import { ROLE_OPTIONS, roleLabel } from '../src/lib/role';

test('가공 역할은 로그인과 작업 화면에서 가공 작업자로 표시한다', () => {
  assert.equal(ROLE_OPTIONS.find(entry => entry.key === 'manufacturing')?.label, '가공 작업자');
  assert.equal(roleLabel({ kind: 'worker', purpose: 'manufacturing' }), '가공 작업자');
});

test('일반 사용자 DB 조회는 사례 상세와 이력을 열고 변경 요청을 보내지 않는다', async () => {
  const calls: string[] = [];
  const row = { case_id: 'case-public', case_title: '영점 확인 사례', active: true, vector_status: 'failed', link_count: 0 };
  globalThis.fetch = async (input, options = {}) => {
    calls.push(options.method ?? 'GET');
    const path = new URL(String(input)).pathname;
    let body: any;
    if (path.endsWith('/schema')) body = { fields: [], excel: { required_columns: [], columns: [], info_columns: [] } };
    else if (path.endsWith('/summary')) body = { uploads: { applied: 0, files: 0, rows: 0, rejected: 0 }, cases: { total: 1, active: 1, inactive: 0 }, vector: { ready: 0, failed: 1, pending: 0 }, links: { active: 0, cases: 0, unlinked: 0 } };
    else if (path.endsWith('/error-cases')) body = { total: 1, items: [row] };
    else if (path.endsWith('/case-public')) body = { case: row, links: [], history: [] };
    else if (path.endsWith('/uploads') || path.endsWith('/links')) body = { items: [] };
    else throw Error(`Unexpected DB request: ${path}`);
    return new Response(JSON.stringify(body));
  };
  await mount(<AdminReadOnlyContext.Provider value={true}><UnsavedChangesProvider registry={registry}><ErrorDbManager onOpenLocation={() => {}} /></UnsavedChangesProvider></AdminReadOnlyContext.Provider>);
  try {
    const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text));
    assert.ok(!button('사례 등록'));
    await act(async () => (Array.from(document.querySelectorAll('tbody tr'))[0] as HTMLElement).click());
    assert.ok(document.querySelector('[aria-label="사례 상세"]')?.textContent?.includes('영점 확인 사례'));
    assert.ok(!button('수정'));
    assert.ok(!button('비활성화'));
    assert.ok(!button('벡터 재시도'));
    await act(async () => button('③ 벡터 반영')!.click());
    assert.ok(!button('실패·대기 전체 재시도'));
    await act(async () => button('① 엑셀 업로드')!.click());
    assert.equal(document.querySelector('input[type="file"]'), null);
    assert.ok(document.body.textContent?.includes('업로드 이력'));
    assert.ok(calls.every(method => method === 'GET'));
    await act(async () => root.render(<AdminReadOnlyContext.Provider value={false}><UnsavedChangesProvider registry={registry}><ErrorDbManager onOpenLocation={() => {}} /></UnsavedChangesProvider></AdminReadOnlyContext.Provider>));
    assert.ok(document.querySelector('input[type="file"]'), 'administrator retains Excel upload');
    await act(async () => button('② 가공 오류 DB')!.click());
    assert.ok(button('사례 등록'), 'administrator retains case registration');
  } finally { await unmount(); }
});

import { ManufacturingPanel } from '../src/components/ManufacturingPanel';

test('태블릿 가공 단계는 앞 단계 미완료 상태에서도 중삭·정삭 화면으로 이동한다', async () => {
  const transitions: string[] = [];
  const status = { unlocked: false, required: 2, passed: 0, failed: 0, complete: false };
  const machining: any = { plan: { stage_labels: { '1': '황삭', '2': '중삭', '3': '정삭' }, serials: ['PR01'], status: { '1': { ...status, unlocked: true }, '2': status, '3': status } }, stage: '1', setStage: (value: string) => transitions.push(value), serial: 'PR01', setSerial() {}, loading: false, error: '' };
  await mount(<ManufacturingPanel drawingId="test-drawing" revision="rev-1" position={0} total={0} labelTotal={2} onNavigate={() => {}} machining={machining} />);
  try {
    const stages = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="가공 단계 선택"] button'));
    assert.equal(stages.length, 3);
    for (const stage of stages) assert.equal(stage.disabled, false);
    await act(async () => { stages[1].click(); stages[2].click(); });
    assert.deepEqual(transitions, ['2', '3']);
    assert.equal(machining.plan.status['1'].passed, 0, '단계 탐색은 측정 완료를 만들지 않는다');
  } finally { await unmount(); }
});

test('관리자 인증 없이도 네 역할을 선택하고 관리자 편집 로그인은 별도로 제공한다', async () => {
  const roles: string[] = [];
  await mount(<EvaluationRoleSelect readOnly onSelect={(_, role) => roles.push(role.kind === 'admin' ? 'admin' : role.purpose)} onSignOut={() => {}} />);
  try {
    const buttons = document.querySelectorAll<HTMLButtonElement>('[aria-label="평가 역할 선택"] button');
    assert.equal(buttons.length, 4);
    assert.ok(document.body.textContent?.includes('조회 전용'));
    assert.equal(document.querySelector('a')?.getAttribute('href'), '/admin-login');
    for (const button of buttons) await act(async () => button.click());
    assert.deepEqual(roles, ['admin', 'manufacturing', 'assembly', 'verification']);
    assert.ok(!document.body.textContent?.includes('관리자 인증 완료'));
  } finally { await unmount(); }
});

test('일반 접속자의 관리자 도면 검토는 입력·저장을 막고 항목 탐색을 허용한다', async () => {
  const items = doc.items.map((item, index) => ({ ...item, id: `dimension_${index + 1}` }));
  const source: any = { drawing_id: doc.drawing_id, revision: 'rev-1', result: { ...doc, items }, review: { gdt: [], dimensions: items.map((item, index) => ({ item_id: item.id, no: index + 1, text: item.raw_text, position: item.position, position_image: item.position })), warnings: [] } };
  let navigated = '';
  await mount(<UnsavedChangesProvider registry={registry}><DrawingReviewPanel source={source} readOnly onSaved={() => assert.fail('read-only review must not save')} onSelectItem={id => { navigated = id; }} selectedItemId="dimension_1" /></UnsavedChangesProvider>);
  try {
    assert.ok(document.body.textContent?.includes('조회 전용'));
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === '검토 완료 및 서버 저장')!;
    assert.equal(save.disabled, true);
    assert.equal((document.querySelector('[aria-label="검토자"]') as HTMLInputElement).disabled, true);
    assert.ok(document.querySelector('fieldset')?.disabled);
    await act(async () => (document.querySelector('[aria-label="다음 항목"]') as HTMLButtonElement).click());
    assert.equal(navigated, 'dimension_2');
  } finally { await unmount(); }
});

test('첫 역할 선택 화면은 도다미 이름과 기존 엔진 선화 배경을 표시한다', async () => {
  await mount(<EvaluationRoleSelect readOnly onSelect={() => {}} onSignOut={() => {}} />);
  try {
    assert.ok(document.body.textContent?.includes('도다미'));
    assert.ok(document.querySelector('img[src$="login-engine-lineart.png"]'));
    assert.ok(document.querySelector('img[src$="login-engine-full-lineart.png"]'));
    assert.equal(document.querySelectorAll('[aria-label="평가 역할 선택"] button').length, 4);
  } finally { await unmount(); }
});

test('휴대폰 관리자 검토에서 도면을 접어도 아래 확인사항과 입력 DOM이 유지된다', async () => {
  globalThis.fetch = async () => new Response('{"parts":[]}');
  await mount(<MobileShell {...mobileProps} inWorkspace selectedDrawing={pdfDrawing} document={doc} revision="rev-1" resultUrl="/drawing.png" points={points} activePoint={points[0]} reviewPane={<div className="review-pair-wrap h-full"><label>치수 확인<input aria-label="검토 입력 유지" defaultValue="76" /></label><p>작업자 검사 기준</p></div>} />);
  try {
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === '항목 검토 시작')!.click());
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-admin-review-drawing"]')!;
    const input = document.querySelector<HTMLInputElement>('[aria-label="검토 입력 유지"]')!;
    assert.ok(document.querySelector('.mobile-admin-review'));
    assert.ok(document.querySelector('#mobile-admin-review-drawing'));
    input.value = '76.2';
    await act(async () => toggle.click());
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('#mobile-admin-review-drawing'), null);
    assert.equal(document.querySelector('[aria-label="검토 입력 유지"]'), input);
    assert.equal(input.value, '76.2');
    await act(async () => toggle.click());
    assert.ok(document.querySelector('#mobile-admin-review-drawing'));
    assert.ok(document.body.textContent?.includes('작업자 검사 기준'));
  } finally { await unmount(); }
});

test('휴대폰 대표 도면 열기 영역은 하단 안전 여백을 두고 기존 도면을 연다', async () => {
  let opened = '';
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/parts')) return new Response(JSON.stringify({ parts: [{ part_id: 'part', name: '피스톤 로드', engine_part_key: 'piston_rod' }] }));
    if (path.endsWith('/drawings')) return new Response(JSON.stringify({ drawings: [pdfDrawing] }));
    throw Error(`Unexpected representative drawing request: ${path}`);
  };
  await mount(<MobileShell {...mobileProps} selection={{ engineKey: 'piston_rod', partId: null, drawingId: null }} onOpenDrawing={value => { opened = value.drawing_id; }} />);
  try {
    const panel = document.querySelector<HTMLElement>('[aria-label="선택한 부품"]')!;
    assert.ok(panel.closest('.mobile-engine-shell'));
    assert.ok(panel.getAttribute('style')?.includes('28px'));
    assert.ok(panel.getAttribute('style')?.includes('safe-area-inset-bottom'));
    const open = Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('대표 도면 열기'))!;
    assert.ok(open);
    await act(async () => open.click());
    assert.equal(opened, pdfDrawing.drawing_id);
  } finally { await unmount(); }
});

import { MeasureTask } from '../src/components/mobile/MobileTask';

for (const purpose of ['manufacturing', 'assembly', 'verification'] as const) {
  test(`휴대폰 ${purpose} 하단 이전·다음 바는 안전 여백을 유지하며 항목을 이동한다`, async () => {
    mockFetch(); requests.length = 0;
    const selected: number[] = [];
    const Component = purpose === 'manufacturing' ? ManufacturingTask : MeasureTask;
    function TaskHarness() {
      const [active, setActive] = useState(points[0].id);
      return (<Component purpose={purpose} mode="view" partName="피스톤 로드" drawing={drawing} document={doc} revision="rev-1" resultUrl={null} points={points} activePoint={points.find(point => point.id === active)} onSelectPoint={id => { selected.push(id); setActive(id); }} measurementRecords={{}} onMeasurementSaved={() => {}} trial={{}} onTrial={() => assert.fail('navigation must not record trial values')} onBack={() => {}} onExports={() => {}} />);
    }
    await mount(<TaskHarness />);
    try {
      const bar = document.querySelector<HTMLElement>('[aria-label="측정 항목 이동"]')!;
      assert.ok(bar);
      assert.ok(bar.getAttribute('style')?.includes('28px'));
      assert.ok(bar.getAttribute('style')?.includes('safe-area-inset-bottom'));
      await act(async () => (bar.querySelector('[aria-label="다음 항목"]') as HTMLButtonElement).click());
      assert.equal(selected.at(-1), points[1].id);
      await act(async () => (bar.querySelector('[aria-label="이전 항목"]') as HTMLButtonElement).click());
      assert.ok(selected.length >= 2);
      assert.ok(requests.every(request => request.method === 'GET'));
    } finally { await unmount(); }
  });
}

test('로그인 첫 제목은 도다미이고 역할 선택 안내는 보조 제목으로 제공한다', async () => {
  await mount(<EvaluationRoleSelect readOnly onSelect={() => {}} onSignOut={() => {}} />);
  try {
    assert.equal(document.querySelector('h1')?.textContent, '도다미');
    assert.ok(document.querySelector('h1')?.classList.contains('brand-wordmark'));
    assert.equal(document.querySelector('h2')?.textContent, '체험할 역할을 선택해주세요');
  } finally { await unmount(); }
});
