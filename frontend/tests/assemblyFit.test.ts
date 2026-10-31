import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownFit, collectPeerItems, findFitPairs, clearanceRange, classifyFit, loadPeerItems, limitsOf } from '../src/lib/assemblyFit';
import type { OcrItem } from '../src/lib/ocr';

const item = (extra: Partial<OcrItem> = {}): OcrItem => ({
  id: 'diameter', category: 'DIMENSION', raw_text: 'Ø50', position: { x: 0, y: 0 },
  feature_type: 'HOLE', measurement_characteristic: 'DIAMETER', nominal_value: 50,
  lower_limit: 50, upper_limit: 50.02, inspection_approved: true, unit: 'mm', ...extra,
});
const drawing = { drawingId: 'peer', partId: 'other', partName: '상대 부품', fileName: 'peer.pdf' };

test('간극은 구멍 최소−축 최대, 구멍 최대−축 최소로 계산', () => {
  assert.deepEqual(clearanceRange({ lower: 50, upper: 50.02 }, { lower: 49.97, upper: 49.99 }), { min: 0.01, max: 0.05 });
  assert.equal(classifyFit(0.01, 0.05), 'clearance');
  assert.equal(classifyFit(-0.05, -0.01), 'interference');
  assert.equal(classifyFit(-0.01, 0.02), 'transition');
});
test('제외 치수는 숨기고 미확정 기준은 계산하지 않음', () => {
  assert.equal(ownFit(item({ excluded: true })).kind, 'hidden');
  assert.equal(ownFit(item({ defaults_applied: ['feature_type'] })).kind, 'unconfirmed');
  const own = ownFit(item({ inspection_approved: false }));
  assert.equal(own.kind, 'confirmed');
  if (own.kind === 'confirmed') assert.equal(own.limits, null);
});
test('미승인·제외·기본 형상·잘못된 범위는 후보 제외, 원래 번호 유지', () => {
  const peers = collectPeerItems(drawing, [
    item({ excluded: true }), item({ inspection_approved: false }),
    item({ defaults_applied: ['feature_type'] }), item({ lower_limit: 51, upper_limit: 50 }),
    item({ id: 'valid' }),
  ]);
  assert.equal(peers.length, 1);
  assert.equal(peers[0].number, 5);
  assert.equal(peers[0].itemId, 'valid');
  assert.equal(limitsOf(item({ lower_limit: NaN })), null);
});
test('같은 기준치수·반대 형상·같은 단위만 짝 후보', () => {
  const own = ownFit(item());
  assert.equal(own.kind, 'confirmed');
  if (own.kind !== 'confirmed') return;
  const peers = collectPeerItems(drawing, [
    item({ id: 'same-shape' }), item({ id: 'other-size', feature_type: 'SHAFT', nominal_value: 51 }),
    item({ id: 'other-unit', feature_type: 'SHAFT', unit: 'inch' }),
    item({ id: 'match', feature_type: 'SHAFT', lower_limit: 49.97, upper_limit: 49.99 }),
  ]);
  const matches = findFitPairs(own, peers);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].peer.itemId, 'match');
  assert.equal(matches[0].minClearance, 0.01);
  const reverse = ownFit(item({ feature_type: 'SHAFT', lower_limit: 49.97, upper_limit: 49.99 }));
  if (reverse.kind === 'confirmed') assert.equal(findFitPairs(reverse, collectPeerItems(drawing, [item()]))[0].maxClearance, 0.05);
});
test('서버 조회는 GET만 사용, 같은 부품과 미검토 도면 제외', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.ok(!init?.method || init.method === 'GET');
    const path = new URL(String(input)).pathname;
    urls.push(path);
    let body: unknown;
    if (path === '/api/parts') body = { parts: [{ part_id: 'current' }, { part_id: 'other' }] };
    else if (path === '/api/parts/current/drawings') body = { drawings: [{ drawing_id: 'here' }, { drawing_id: 'same-part' }] };
    else if (path === '/api/parts/other/drawings') body = { drawings: [{ drawing_id: 'reviewed', original_filename: 'ok.pdf' }, { drawing_id: 'pending' }] };
    else if (path.endsWith('/ocr')) body = { status: 'completed', result: { review_status: path.includes('reviewed') ? 'reviewed' : 'pending', items: [item()] } };
    else throw new Error(`unexpected ${path}`);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const peers = await loadPeerItems('here');
    assert.equal(peers.length, 1);
    assert.equal(peers[0].drawingId, 'reviewed');
    assert.ok(!urls.some((url) => /\/(here|same-part)\/ocr$/.test(url)));
    await assert.rejects(loadPeerItems('missing'), /소속 부품/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(loadPeerItems('here', controller.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
