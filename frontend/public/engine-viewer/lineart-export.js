/*
 * 엔진 선화(라인아트) 내보내기 — 로그인 배경 이미지를 만드는 일회성 도구.
 * 뷰어를 ?embed=1&lineart=1&save=<저장 주소> 로 열면 조립 상태의 엔진을 정해진 사선 시점에서 그려
 * 투명 PNG 로 만든 뒤 save 주소에 POST 한다. 평소 뷰어 동작에는 관여하지 않는다 (lineart=1 일 때만 불러옴).
 *
 * 선 고르는 규칙 (모든 삼각형 모서리를 그리지 않는다):
 *  - 윤곽선(실루엣): 이웃한 두 면 중 하나만 카메라를 향하는 모서리
 *  - 형상선: 이웃한 두 면의 각도가 FEATURE_DEG 이상인 모서리 (원통의 테두리·단차·모따기)
 *  - 열린 모서리: 면이 하나뿐인 모서리
 * 가려진 선(은선)은 아주 옅게, 보이는 선은 또렷하게 그린다 (깊이만 쓰는 면으로 가림 판정).
 */
(function () {
  const params = new URLSearchParams(location.search);
  const SAVE_URL = params.get('save');
  const WIDTH = Number(params.get('w') || 3200), HEIGHT = Number(params.get('h') || 1800);
  const FEATURE_DEG = 32;
  const VISIBLE = new THREE.Color(0xd6e6f7), HIDDEN_ALPHA = 0.16;

  // 시점: 앞쪽 비스듬히 위에서 본 투시 (엔진 길이 방향이 화면 가로로 길게)
  // (주소 값으로 바꿔 볼 수 있다: dir=x,y,z · dist · fov · target=x,y,z)
  const vec = (name, fallback) => {
    const v = (params.get(name) || '').split(',').map(Number);
    return v.length === 3 && v.every(Number.isFinite) ? new THREE.Vector3(...v) : fallback;
  };
  const TARGET = vec('target', new THREE.Vector3(5.9, 4.2, 0.2));
  const DIR = vec('dir', new THREE.Vector3(-0.42, 0.34, 0.84)).normalize();
  const DIST = Number(params.get('dist') || 21.5), FOV = Number(params.get('fov') || 30);

  function status(text) {
    let el = document.getElementById('lineartStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lineartStatus';
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;background:#0b1520;color:#dbe6f0;font:12px monospace;padding:4px 8px;border-radius:4px';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  function edgeSegments(mesh, cameraPos) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const index = geo.index ? geo.index.array : null;
    const triCount = index ? index.length / 3 : pos.count / 3;
    // 같은 위치의 정점을 하나로 묶는다 (GLB 는 각진 모서리에서 정점을 나눠 두므로)
    const keyOf = new Map(), weld = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
      let id = keyOf.get(k);
      if (id === undefined) { id = keyOf.size; keyOf.set(k, id); }
      weld[i] = id;
    }
    const world = mesh.matrixWorld;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const faceNormal = new Float32Array(triCount * 3), faceCenter = new Float32Array(triCount * 3);
    const edges = new Map();   // "lo,hi" → [faceA, faceB?, vi, vj]
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index[t * 3] : t * 3, i1 = index ? index[t * 3 + 1] : t * 3 + 1, i2 = index ? index[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(world);
      b.fromBufferAttribute(pos, i1).applyMatrix4(world);
      c.fromBufferAttribute(pos, i2).applyMatrix4(world);
      const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
      if (n.lengthSq() < 1e-20) continue;   // 넓이 없는 삼각형
      n.normalize();
      faceNormal.set([n.x, n.y, n.z], t * 3);
      faceCenter.set([(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3], t * 3);
      for (const [p, q] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const wp = weld[p], wq = weld[q];
        if (wp === wq) continue;
        const key = wp < wq ? `${wp},${wq}` : `${wq},${wp}`;
        const entry = edges.get(key);
        if (entry) entry[1] = t; else edges.set(key, [t, -1, p, q]);
      }
    }
    const cosFeature = Math.cos(THREE.MathUtils.degToRad(FEATURE_DEG));
    const out = [];
    const facing = (t) => {
      const vx = cameraPos.x - faceCenter[t * 3], vy = cameraPos.y - faceCenter[t * 3 + 1], vz = cameraPos.z - faceCenter[t * 3 + 2];
      return faceNormal[t * 3] * vx + faceNormal[t * 3 + 1] * vy + faceNormal[t * 3 + 2] * vz;
    };
    for (const [f0, f1, p, q] of edges.values()) {
      let keep = false;
      if (f1 < 0) keep = true;   // 열린 모서리
      else {
        const dot = faceNormal[f0 * 3] * faceNormal[f1 * 3] + faceNormal[f0 * 3 + 1] * faceNormal[f1 * 3 + 1] + faceNormal[f0 * 3 + 2] * faceNormal[f1 * 3 + 2];
        if (dot < cosFeature) keep = true;                       // 형상선
        else if ((facing(f0) > 0) !== (facing(f1) > 0)) keep = true;   // 윤곽선
      }
      if (!keep) continue;
      a.fromBufferAttribute(pos, p).applyMatrix4(world);
      b.fromBufferAttribute(pos, q).applyMatrix4(world);
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    return out;
  }

  async function run() {
    status('선화 계산 중…');
    if (typeof setRun === 'function') setRun(false);
    theta = 0; expT = 0; expTarget = null; pose();
    root.updateMatrixWorld(true);

    const cam = new THREE.PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.1, 200);
    cam.position.copy(TARGET).addScaledVector(DIR, DIST);
    cam.lookAt(TARGET);
    cam.updateMatrixWorld(true);

    const depthScene = new THREE.Scene(), lineScene = new THREE.Scene();
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
    const segments = [];
    let meshCount = 0;
    root.traverse(o => {
      if (!o.isMesh || o.userData.edge || !isShown(o)) return;
      meshCount++;
      const depth = new THREE.Mesh(o.geometry, depthMat);
      depth.matrixAutoUpdate = false;
      depth.matrix.copy(o.matrixWorld);
      depthScene.add(depth);
      const seg = edgeSegments(o, cam.position);
      for (let i = 0; i < seg.length; i++) segments.push(seg[i]);
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const hidden = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: VISIBLE, transparent: true, opacity: HIDDEN_ALPHA, depthTest: false, depthWrite: false }));
    const visible = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: VISIBLE, transparent: true, opacity: 0.95 }));
    lineScene.add(hidden);
    depthScene.add(visible);

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(WIDTH, HEIGHT, false);
    r.setClearColor(0x000000, 0);
    r.autoClear = false;
    r.clear();
    r.render(lineScene, cam);      // 은선 (가림 판정 없이 옅게)
    r.render(depthScene, cam);     // 깊이 면 + 보이는 선

    status(`선 ${segments.length / 6} 개 · 메쉬 ${meshCount} · 저장 중…`);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    window.__lineart = { segments: segments.length / 6, meshes: meshCount, bytes: blob.size };
    if (SAVE_URL) {
      const resp = await fetch(SAVE_URL, { method: 'POST', body: blob });
      status(`저장 ${resp.ok ? '완료' : '실패 ' + resp.status} · ${(blob.size / 1024).toFixed(0)} KB · 선 ${segments.length / 6} 개`);
    } else {
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#0b1520;z-index:8';
      document.body.appendChild(img);
      status(`미리보기 · 선 ${segments.length / 6} 개 (save 주소가 없어 저장하지 않음)`);
    }
  }

  assembled.then(() => setTimeout(() => run().catch(err => status('오류: ' + err.message)), 300));
})();
