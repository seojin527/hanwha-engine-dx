import { EngineExplorerPanel, type EngineSelection } from "../src/components/shell/EngineExplorerPanel";
import { UnsavedChangesProvider } from "../src/lib/unsavedChanges";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DrawingSelectScreen } from '../src/components/entry/DrawingSelectScreen';
import { DrawingThumb, reviewState } from '../src/components/drawings/DrawingParts';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const drawings = [
  { drawing_id: 'd1', part_id: 'p1', name: '도면 1', original_filename: 'one.pdf', media_type: 'application/pdf', size_bytes: 1200, ocr_status: 'completed', review_status: 'unreviewed' },
  { drawing_id: 'd2', part_id: 'p1', name: '도면 2', original_filename: 'two.pdf', media_type: 'application/pdf', size_bytes: 1200, ocr_status: 'completed', review_status: 'reviewed' },
];
test('도면 선택은 미리보기만 변경하고 작업 시작은 명시적으로 실행', async () => {
  const requests: string[] = []; const started: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname; requests.push(path);
    return new Response(JSON.stringify(path === '/api/parts' ? { parts: [{ part_id: 'p1', name: '부품', drawing_count: 2 }] } : { drawings }));
  };
  const root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<DrawingSelectScreen userLabel="작업자" initialPartId="p1" onStart={d => started.push(d.drawing_id)} onDemo={() => {}} onExit={() => {}} />));
  try {
    const rows = document.querySelectorAll('tbody tr');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent!, /OCR 완료.*검토 전/);
    assert.match(rows[1].textContent!, /OCR 완료.*검토 완료/);
    await act(async () => rows[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    const preview = document.querySelector('[aria-label="선택 도면 미리보기"]')!;
    assert.ok(preview.querySelector('img')!.getAttribute('src')!.includes('/d1/thumbnail?size=lg'));
    assert.deepEqual(started, []);
    await act(async () => rows[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.ok(preview.querySelector('img')!.getAttribute('src')!.includes('/d2/thumbnail?size=lg'));
    assert.equal(document.querySelectorAll('[aria-label="선택 도면 미리보기"]').length, 1);
    const start = [...preview.querySelectorAll('button')].find(b => b.textContent!.includes('작업 시작'))!;
    await act(async () => start.click());
    assert.deepEqual(started, ['d2']);
    assert.equal(requests.some(path => /ocr/.test(path)), false);
  } finally { await act(async () => root.unmount()); }
});
test('미리보기 실패 안내와 도면 변경 후 이미지 복구', async () => {
  globalThis.fetch = async () => new Response('', { status: 404 });
  const root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<DrawingThumb drawing={drawings[0] as any} />));
  await act(async () => document.querySelector('img')!.dispatchEvent(new dom.window.Event('error')));
  assert.match(document.body.textContent!, /도면 확인 필요/);
  await act(async () => root.render(<DrawingThumb drawing={drawings[1] as any} />));
  assert.ok(document.querySelector('img'));
  assert.equal(document.body.textContent!.includes('미리보기 없음'), false);
  assert.equal(reviewState({ ocr_status: 'completed', review_status: 'unreviewed' }).label, '검토 전');
  await act(async () => root.unmount());
});

test('3D 부품의 연결 도면 선택과 접기·닫기는 작업 화면을 열지 않음', async () => {
  const started: string[] = [];
  globalThis.fetch = async input => new Response(JSON.stringify(new URL(String(input)).pathname === '/api/parts'
    ? { parts: [{ part_id: 'p1', name: '부품', drawing_count: 2, engine_part_key: 'CR' }] } : { drawings }));
  function Explorer() {
    const [selection, onSelect] = useState<EngineSelection>({ engineKey: 'CR', partId: 'p1', drawingId: null });
    return <UnsavedChangesProvider registry={new Set()}><EngineExplorerPanel model={null} selection={selection} onSelect={onSelect} canManage={false} refreshKey={0} onOpenDrawing={d => started.push(d.drawing_id)} onUploaded={() => {}} /></UnsavedChangesProvider>;
  }
  const root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<Explorer />));
  try {
    const dock = document.querySelector('[aria-label="도면 미리보기"]')!;
    assert.ok(dock);
    const thumb = dock.querySelector('[aria-label="연결 도면 썸네일"] button') as HTMLButtonElement;
    await act(async () => thumb.click());
    assert.ok(dock.querySelector('img[src$="d1/thumbnail?size=lg"]'));
    assert.deepEqual(started, []);
    await act(async () => (dock.querySelector('[aria-label="미리보기 접기"]') as HTMLButtonElement).click());
    assert.equal(dock.querySelector('img'), null);
    await act(async () => (dock.querySelector('[aria-label="미리보기 닫기"]') as HTMLButtonElement).click());
    assert.equal(document.querySelector('[aria-label="도면 미리보기"]'), null);
    assert.deepEqual(started, []);
  } finally { await act(async () => root.unmount()); }
});
