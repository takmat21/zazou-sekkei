import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const $ = id => document.getElementById(id);
const COARSE = matchMedia('(pointer:coarse)').matches;
(async () => { try {
const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
r.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.75 : 2));
r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.02; r.outputColorSpace = THREE.SRGBColorSpace;
$('stage').appendChild(r.domElement);
const scene = new THREE.Scene();
const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(r), 0.04).texture; pm.dispose();
const cam = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
const ctl = new OrbitControls(cam, r.domElement);
ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.maxPolarAngle = Math.PI * 0.49; ctl.minDistance = 1.2; ctl.maxDistance = 45; ctl.screenSpacePanning = true;

// 光：空の光＋やわらかい日差し（影は1枚だけ）
scene.add(new THREE.HemisphereLight('#ffffff', '#d8d0c4', 0.55));
const sun = new THREE.DirectionalLight('#fff4e6', 2.1); sun.position.set(2.2, 9, 3.2); sun.castShadow = true;
const SM = COARSE ? 1024 : 2048; sun.shadow.mapSize.set(SM, SM);
Object.assign(sun.shadow.camera, { left: -5.5, right: 5.5, top: 5.5, bottom: -5.5, near: 1, far: 22 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; scene.add(sun); scene.add(sun.target);

// 床タイル（300角・目地）は絵で作る（外の画像は使わない）
function tileTex() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#d9d5cd'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const v = [0, 6, -5, 3][i * 2 + j]; g.fillStyle = `rgb(${217 + v},${213 + v},${205 + v})`; g.fillRect(i * 256 + 3, j * 256 + 3, 250, 250);
  }
  const img = g.getImageData(0, 0, 512, 512); for (let k = 0; k < img.data.length; k += 4) { const n = (Math.random() - .5) * 7; img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n; }
  g.putImageData(img, 0, 0); g.fillStyle = '#b8b2a8';
  for (const p of [0, 256]) { g.fillRect(p, 0, 3, 512); g.fillRect(0, p, 512, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = r.capabilities.getMaxAnisotropy(); return t;
}
const gltf = await new GLTFLoader().loadAsync('kitchen.glb');
const root = gltf.scene; scene.add(root);
const box = new THREE.Box3().setFromObject(root); const ctr = box.getCenter(new THREE.Vector3());
root.position.set(-ctr.x, 0, -ctr.z); root.updateMatrixWorld(true);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: '#3a3328', opacity: 0.16 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = box.min.y - 0.001; ground.receiveShadow = true; scene.add(ground);

const LINE = new THREE.LineBasicMaterial({ color: '#23262b', transparent: true, opacity: 0.32 });
const LINE_ARCH = new THREE.LineBasicMaterial({ color: '#3b3732', transparent: true, opacity: 0.22 });
const tex = tileTex(); const picks = []; const items = {};
root.traverse(o => {
  if (!o.isMesh) return;
  let n = o; while (n && !n.userData.dims && n.parent !== root) n = n.parent;   // extras に寸法がある部品だけ選べる（userData.name は glTF の名前が入る）
  const node = n && n.userData.dims ? n : null;
  const m = o.material; const mn = m.name;
  m.envMapIntensity = mn.startsWith('stainless') ? 1.05 : 0.5;
  o.castShadow = !['floor_tile', 'aisle', 'slab'].includes(mn); o.receiveShadow = mn !== 'aisle';
  if (mn === 'floor_tile') {   // 上から見た位置で目地を貼る（部屋の角から 600 ごとに 2×2 枚）
    const p = o.geometry.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 0.6; uv[i * 2 + 1] = -p.getZ(i) / 0.6; }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); m.map = tex; m.color.set('#ffffff'); m.roughness = 0.62; m.needsUpdate = true;
  }
  if (mn === 'aisle') { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; o.renderOrder = 2; }
  if (mn !== 'aisle' && mn !== 'floor_tile') {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 32), ['wall', 'cut', 'slab'].includes(mn) ? LINE_ARCH : LINE);
    e.raycast = () => {}; o.add(e);
  }
  if (node) {
    o.material = m.clone(); o.userData.node = node; picks.push(o);
    const k = node.name; (items[k] ||= { node, mats: [], info: node.userData }).mats.push(o.material);
  }
});

// 番号札と通路の文字
const bds = [];
for (const [k, it] of Object.entries(items)) {
  const b = new THREE.Box3().setFromObject(it.node), info = it.info;
  const el = document.createElement('div');
  if (info.kind === 'aisle') { el.className = 'fl'; el.textContent = `通路 ${info.dims.replace('幅 ', '')}`; it.anchor = b.getCenter(new THREE.Vector3()); }
  else {
    el.className = 'bd'; el.textContent = info.no; it.anchor = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.16, (b.min.z + b.max.z) / 2);
    el.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') show(k, ev.clientX, ev.clientY); });
    el.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') show(null); });
    el.addEventListener('click', ev => { show(k, ev.clientX, ev.clientY, ev.pointerType !== 'mouse'); ev.stopPropagation(); });
  }
  el.style.transform = 'translate(-200px,-200px)';   // 置く前は画面の外（左上のカーソルに触れて表示が出ないように）
  $('badges').appendChild(el); it.el = el; bds.push(it);
}
const ordered = Object.entries(items).filter(([, it]) => it.info.no).sort((a, b) => a[1].info.no - b[1].info.no);
for (const [k, it] of ordered) {
  const d = document.createElement('div'); d.innerHTML = `<i>${it.info.no}</i><span>${it.info.name}</span><em>${it.info.dims}</em>`;
  d.addEventListener('mouseenter', () => { const p = toScreen(it.anchor); show(k, p.x, p.y); }); d.addEventListener('mouseleave', () => show(null));
  $('list').appendChild(d); it.row = d;
}

// 表示
let cur = null;
function show(k, x, y, touch) {
  if (cur && items[cur]) { items[cur].mats.forEach(m => m.emissive.set('#000000')); items[cur].el.classList.remove('on'); items[cur].row?.classList.remove('on'); }
  cur = k; const tip = $('tip');
  if (!k) { tip.classList.remove('show'); req(); return; }
  const it = items[k], f = it.info;
  it.mats.forEach(m => m.emissive.set(f.kind === 'aisle' ? '#3a2400' : '#4a3010')); it.el.classList.add('on'); it.row?.classList.add('on');
  tip.innerHTML = (f.no ? `<div class="no">No. ${f.no}</div>` : `<div class="no">AISLE</div>`) + `<h2>${f.name}</h2><dl>` +
    `<dt>寸法</dt><dd>${f.dims}${f.no ? '（mm）' : ' mm'}</dd>` + (f.util ? `<dt>設備</dt><dd>${f.util}</dd>` : '') + (f.note ? `<dt>高さ</dt><dd>${f.note}</dd>` : '') + '</dl>';
  tip.classList.toggle('touch', !!touch); $('hint').style.opacity = 0;
  const w = 280, h = 120; let tx = x + 16, ty = y + 16;
  if (tx + w > innerWidth - 8) tx = x - w - 12; if (ty + h > innerHeight - 90) ty = y - h - 12;
  tip.style.left = Math.max(8, tx) + 'px'; tip.style.top = Math.max(8, ty) + 'px'; tip.classList.add('show'); req();
}
const ray = new THREE.Raycaster(), pt = new THREE.Vector2();
function pick(x, y) {
  pt.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(pt, cam);
  const h = ray.intersectObjects(picks, false)[0]; return h ? h.object.userData.node.name : null;
}
let down = null, hoverQ = null;
r.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
r.domElement.addEventListener('pointerup', e => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { const k = pick(e.clientX, e.clientY); show(k, e.clientX, e.clientY, e.pointerType !== 'mouse'); }
  down = null;
});
r.domElement.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || e.buttons) return;
  if (!hoverQ) requestAnimationFrame(() => { const k = pick(hoverQ.x, hoverQ.y); if (k !== cur || k) show(k, hoverQ.x, hoverQ.y); hoverQ = null; });
  hoverQ = { x: e.clientX, y: e.clientY };
});

// 視点（模型の箱が画面に収まる距離を探す。上と下は文字と釦の分あける）
const bb = new THREE.Box3().setFromObject(root), corners = [];
for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(x, y, z));
const NARROW = () => innerWidth < innerHeight * 0.8;   // 縦長の画面は東南東から（長い辺を奥行きに）
const VIEWS = { iso: { dir: [0.62, 0.78, 0.95], tgt: [0.15, 0.55, 0.1] }, isoN: { dir: [1.0, 1.05, 0.5], tgt: [0.1, 0.5, 0] }, top: { dir: [0, 1, 0.0008], tgt: [0, 0, 0] }, front: { dir: [0, 0.42, 1], tgt: [0, 0.95, 0] } };
function fit(v) {
  const dir = new THREE.Vector3(...v.dir).normalize(), tgt = new THREE.Vector3(...v.tgt), c = cam.clone();
  const narrow = innerWidth < 560, top = narrow ? 0.62 : 0.72, bot = narrow ? -0.68 : -0.74, side = narrow ? 0.94 : (innerWidth > 900 ? 0.6 : 0.9);
  let lo = 1, hi = 40;
  for (let i = 0; i < 26; i++) {
    const d = (lo + hi) / 2; c.position.copy(tgt).addScaledVector(dir, d); c.lookAt(tgt); c.updateMatrixWorld(); c.updateProjectionMatrix();
    const ok = corners.every(p => { const q = p.clone().project(c); return q.z < 1 && q.x > -side && q.x < (innerWidth > 900 ? 0.48 : side) && q.y < top && q.y > bot; });
    ok ? hi = d : lo = d;
  }
  return { pos: tgt.clone().addScaledVector(dir, hi), tgt };
}
let tw = null, view = new URLSearchParams(location.search).get('view') || 'iso';
function go(k, instant) {
  view = k; document.querySelectorAll('#bar button').forEach(b => b.classList.toggle('on', b.dataset.v === k));
  const f = fit(VIEWS[k === 'iso' && NARROW() ? 'isoN' : k]);
  for (const m of items.E05?.mats || []) { m.transparent = k === 'top'; m.opacity = k === 'top' ? 0.28 : 1; m.depthWrite = k !== 'top'; m.needsUpdate = true; }   // 上からはフードを透かして下の機器を見せる
  if (instant) { cam.position.copy(f.pos); ctl.target.copy(f.tgt); tw = null; }
  else tw = { t0: performance.now(), p0: cam.position.clone(), t1: ctl.target.clone(), f };
  req();
}
document.querySelectorAll('#bar button').forEach(b => b.addEventListener('click', () => { show(null); go(b.dataset.v); }));

// 描く（動いている間だけ）
const v3 = new THREE.Vector3();
function toScreen(p) { v3.copy(p).project(cam); return { x: (v3.x + 1) / 2 * innerWidth, y: (1 - v3.y) / 2 * innerHeight, z: v3.z }; }
function badges() {
  for (const it of bds) { const s = toScreen(it.anchor); it.el.style.display = s.z < 1 ? '' : 'none'; it.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`; }
}
let pending = false;
function req() { if (!pending) { pending = true; requestAnimationFrame(frame); } }
function frame(now) {
  pending = false; let moving = false;
  if (tw) {
    const t = Math.min(1, (now - tw.t0) / 700), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    cam.position.lerpVectors(tw.p0, tw.f.pos, e); ctl.target.lerpVectors(tw.t1, tw.f.tgt, e); if (t >= 1) tw = null; moving = true;
  }
  moving = ctl.update() || moving;
  r.render(scene, cam); badges();
  if (moving) req();
}
ctl.addEventListener('change', req);
ctl.addEventListener('start', () => { $('hint').style.opacity = 0; });
function resize() { r.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.fov = cam.aspect < 0.8 ? 52 : 36; cam.updateProjectionMatrix(); req(); }   // 縦長は画角を広げて近づける
addEventListener('resize', () => { resize(); go(view, true); });
resize(); go(view, true);
$('load').style.opacity = 0;
window.__ready = true;
window.__screenOf = no => { const it = Object.values(items).find(i => i.info.no === no); const b = new THREE.Box3().setFromObject(it.node), c = b.getCenter(new THREE.Vector3()); c.y = b.max.y - 0.02; return toScreen(c); };
} catch (e) { console.error(e); $('err').style.display = 'flex'; $('load').style.display = 'none'; } })();
