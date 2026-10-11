import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseSvg, buildMesh, exportObj } from "./geometry.js";
import "./style.css";

const defaults = {
  depth: 24,
  bevelSize: 3,
  bevelSegments: 5,
  curve: 0.5,
  sharpCorners: true,
  hollow: false,
  wallThickness: 4,
  uvScaleX: 1,
  uvScaleY: 1,
  uvOffsetX: 0,
  uvOffsetY: 0,
  uvRotation: 0,
};
const app = document.querySelector("#app");
app.innerHTML = `<header><a class="brand" href="./"><span class="brand-icon">◈</span> PATH<span class="brand-slash">/</span>FORM</a><span class="tagline">パスから、かたちへ。</span><span class="header-label">SVG → 3D STUDIO</span><button id="export" class="primary">↓ OBJ を書き出す</button></header><main><aside class="left-panel"><div class="panel-heading"><span>01 / SOURCE</span><span class="status-dot">●</span></div><h1>輪郭から始めよう。</h1><p class="muted intro">ベクターパスを読み込んで、<br>自由に立体をつくる。</p><label class="dropzone" id="dropzone"><input type="file" id="file" accept=".svg,image/svg+xml" hidden/><span class="upload-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg></span><strong>SVG をドロップ</strong><span>またはクリックして選択</span><small>Illustrator：SVG 形式で保存</small></label><button class="sample-button" id="sample">◈ サンプルを読み込む <span>↗</span></button><div class="section-line"></div><div class="panel-heading"><span>OBJECTS</span><span id="object-count">0</span></div><div id="objects"></div><div class="source-note"><span class="tiny-label">SUPPORTED FORMAT</span><p>閉じた SVG パス・複合パスに対応。<br>文字はアウトライン化してください。</p></div></aside><section class="workspace"><div class="viewport-heading"><span><i class="live-dot"></i> LIVE PREVIEW</span><button id="fit" class="subtle">⊡ 全体表示</button></div><div id="viewport"></div><div class="view-caption"><span>ドラッグで回転 · スクロールでズーム · 右ドラッグで移動</span><span id="mesh-info">—</span></div><div id="message" role="status"></div><div class="uv-panel"><div class="uv-heading"><span>UV MAP <small>展開・調整</small></span><span class="tiny-label">UV 座標を確認</span></div><div class="uv-tools"><label><input type="checkbox" id="uv-edit-mode"/> UV 頂点編集</label><button id="uv-clear" class="subtle">UV 修正をクリア ↺</button><span>頂点をドラッグ · 同じ UV 座標をまとめて編集</span></div><canvas id="uv-canvas" width="700" height="180" aria-label="UV 展開。頂点編集を有効にして頂点をドラッグ"></canvas><div class="uv-inputs">${field("uvScaleX", "スケール X", 1, 0.01, 20, 0.1, false)}${field("uvScaleY", "スケール Y", 1, 0.01, 20, 0.1, false)}${field("uvOffsetX", "移動 U", 0, -20, 20, 0.1, false)}${field("uvOffsetY", "移動 V", 0, -20, 20, 0.1, false)}${field("uvRotation", "回転 °", 0, -360, 360, 1, false)}</div></div></section><aside class="right-panel"><div class="panel-heading"><span>02 / SHAPE</span><button id="reset" class="subtle">リセット ↺</button></div><h2>かたちを調整</h2><p id="selected-name" class="muted">オブジェクトを選択</p><section class="control-section"><h3>押し出し <span>EXTRUDE</span></h3>${field("depth", "奥行き", 24, 1, 100, 1)}</section><section class="control-section"><h3>ベベル <span>BEVEL</span></h3>${field("bevelSize", "幅", 3, 0, 20, 0.1)}${field("bevelSegments", "分割数", 5, 1, 16, 1)}${field("curve", "カーブ形状", 0.5, 0, 1, 0.01)}<div class="curve-display"><svg viewBox="0 0 220 66"><path d="M10 55H210M10 10V55" class="curve-axis"/><path id="curve-path" d="M10 55 Q110 55 210 10"/><circle cx="210" cy="10" r="4"/></svg><span>角張る</span><span>丸みをつける</span></div><label class="toggle-row"><span>尖った角を保持</span><input id="sharpCorners" type="checkbox" checked/><i></i></label><p class="control-note">ベベル幅は輪郭に合わせて自動制限。<br>細い形状では小さい値を推奨します。</p></section><section class="control-section"><h3>内側をくり抜く <span>HOLLOW</span></h3><label class="toggle-row"><span>中空にする</span><input id="hollow" type="checkbox"/><i></i></label>${field("wallThickness", "壁の厚み", 4, 0.1, 30, 0.1)}</section><section class="control-section"><h3>マテリアル <span>MATERIAL</span></h3><label class="color-row"><input type="color" id="color" value="#b6ee75"/><span id="color-value">#B6EE75</span><span class="muted">カラー</span></label></section><p class="footer-note">OBJ + MTL として出力<br>オブジェクトごとのカラーを保存</p></aside></main>`;
function field(id, label, value, min, max, step, range = true) {
  return `<label class="field ${range ? "" : "compact"}"><span>${label}</span><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"/>${range ? `<input data-range="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/>` : ""}</label>`;
}
const scene = new THREE.Scene();
scene.background = new THREE.Color("#171b20");
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
camera.position.set(230, 200, 330);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  document.querySelector("#viewport").innerHTML =
    '<p class="render-error">3D プレビューには WebGL 対応ブラウザが必要です。</p>';
}
let controls;
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.querySelector("#viewport").append(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x4c5664, 2.2));
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(100, 200, 150);
scene.add(light);
const grid = new THREE.GridHelper(600, 30, 0x414852, 0x282f37);
grid.position.y = -85;
scene.add(grid);
const group = new THREE.Group();
scene.add(group);
let objects = [],
  selected = 0;
const $ = (id) => document.getElementById(id);
function notice(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function selectedObject() {
  return objects[selected];
}
function dispose() {
  group.children.slice().forEach((m) => {
    group.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  });
}
function makeMeshes(entries) {
  const meshes = [];
  try {
    entries.forEach((o) => {
      const geometry = buildMesh(o.shape, o.settings);
      const material = new THREE.MeshStandardMaterial({
        color: o.color,
        roughness: 0.44,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.objectId = o.id;
      meshes.push(mesh);
    });
    return meshes;
  } catch (e) {
    meshes.forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
    throw e;
  }
}
function rebuild(prepared) {
  try {
    const meshes = prepared || makeMeshes(objects);
    dispose();
    group.position.set(0, 0, 0);
    meshes.forEach((m) => group.add(m));
    const warnings = meshes.flatMap((m) => m.geometry.userData.warnings || []);
    const box = new THREE.Box3().setFromObject(group),
      center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    $("mesh-info").textContent =
      `${objects.length} OBJECTS · ${group.children.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0).toLocaleString()} VERTICES`;
    notice([...new Set(warnings)].join(" / "));
    drawUV();
    return true;
  } catch (e) {
    notice(e.message, true);
    return false;
  }
}
function fit() {
  if (!group.children.length) return;
  const box = new THREE.Box3().setFromObject(group),
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3()),
    r = Math.max(size.x, size.y, size.z, 10);
  camera.position
    .copy(center)
    .add(new THREE.Vector3(r * 1.15, r * 0.85, r * 1.6));
  camera.near = r / 1000;
  camera.far = r * 100;
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
  grid.position.y = box.min.y - 1;
}
function list() {
  $("object-count").textContent = objects.length;
  $("objects").innerHTML = objects
    .map(
      (o, i) =>
        `<button class="object-row ${selected === i ? "active" : ""}" data-object="${i}"><i style="background:${safeColor(o.color)}"></i><span>${escapeHTML(o.name)}</span><small>↗</small></button>`,
    )
    .join("");
  document.querySelectorAll("[data-object]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = Number(el.dataset.object);
        uvSelectedKey = null;
        uvDragKey = null;
        list();
        sync();
        drawUV();
      }),
  );
}
function safeColor(value) {
  return /^#[\da-f]{6}$/i.test(value) ? value : "#b6ee75";
}
function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function sync() {
  const o = selectedObject();
  if (!o) return;
  $("selected-name").textContent = o.name;
  Object.keys(defaults).forEach((key) => {
    const el = $(key);
    if (el.type === "checkbox") el.checked = o.settings[key];
    else el.value = o.settings[key];
    const range = document.querySelector(`[data-range="${key}"]`);
    if (range) range.value = o.settings[key];
  });
  $("color").value = safeColor(o.color);
  $("color-value").textContent = o.color.toUpperCase();
  curveDraw();
}
function curveDraw() {
  const curve = Number($("curve").value),
    points = selectedObject()?.settings.curvePoints;
  let d = "";
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    let y = (1 - curve) * t + curve * (1 - Math.cos((t * Math.PI) / 2));
    if (points) {
      const right = points.findIndex((p) => p.x >= t);
      const l = points[Math.max(0, right - 1)],
        r = points[Math.max(0, right)];
      y = r.x === l.x ? r.y : l.y + ((r.y - l.y) * (t - l.x)) / (r.x - l.x);
    }
    d += `${i ? "L" : "M"}${10 + 200 * t} ${55 - 45 * y} `;
  }
  $("curve-path").setAttribute("d", d);
  const mid = points?.[1] || {
    x: 0.5,
    y: (1 - curve) * 0.5 + curve * (1 - Math.cos(Math.PI / 4)),
  };
  document
    .querySelector(".curve-display circle")
    .setAttribute("cx", 10 + 200 * mid.x);
  document
    .querySelector(".curve-display circle")
    .setAttribute("cy", 55 - 45 * mid.y);
}
const curveEditor = document.querySelector(".curve-display svg");
curveEditor.setAttribute("role", "slider");
curveEditor.setAttribute(
  "aria-label",
  "ベベル断面の中央制御点。ドラッグまたは上下キーで調整",
);
curveEditor.setAttribute("tabindex", "0");
curveEditor.insertAdjacentHTML(
  "afterend",
  '<small style="grid-column:1/-1;color:#8b97a6;margin-bottom:6px">横：高さ / 縦：オフセット · 制御点をドラッグ</small>',
);
let curveDragging = false;
function editCurve(e) {
  const o = selectedObject();
  if (!o) return;
  const rect = curveEditor.getBoundingClientRect(),
    x = Math.max(
      0.05,
      Math.min(0.95, (((e.clientX - rect.left) / rect.width) * 220 - 10) / 200),
    ),
    y = Math.max(
      0,
      Math.min(1, (55 - ((e.clientY - rect.top) / rect.height) * 66) / 45),
    );
  const clearedUV = clearShapeUV(o);
  o.settings.curvePoints = [
    { x: 0, y: 0 },
    { x, y },
    { x: 1, y: 1 },
  ];
  curveDraw();
  rebuild();
  if (clearedUV) notice("形状の変更に伴い UV 頂点修正をクリアしました。");
}
curveEditor.onpointerdown = (e) => {
  curveDragging = true;
  curveEditor.setPointerCapture(e.pointerId);
  editCurve(e);
};
curveEditor.onpointermove = (e) => {
  if (curveDragging) editCurve(e);
};
curveEditor.onpointerup = () => {
  curveDragging = false;
};
curveEditor.onpointercancel = () => {
  curveDragging = false;
};
curveEditor.onkeydown = (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const o = selectedObject();
    if (!o) return;
    const clearedUV = clearShapeUV(o);
    const mid = o.settings.curvePoints?.[1] || { x: 0.5, y: 0.5 };
    o.settings.curvePoints = [
      { x: 0, y: 0 },
      {
        x: mid.x,
        y: Math.max(
          0,
          Math.min(1, mid.y + (e.key === "ArrowUp" ? 0.05 : -0.05)),
        ),
      },
      { x: 1, y: 1 },
    ];
    curveDraw();
    rebuild();
    if (clearedUV) notice("形状の変更に伴い UV 頂点修正をクリアしました。");
  }
};
async function load(text, name) {
  try {
    const parsed = parseSvg(text);
    if (!parsed.objects.length)
      throw new Error(
        "閉じたパスが見つかりません。文字はアウトライン化して SVG に保存してください。",
      );
    const next = parsed.objects.map((o, i) => ({
      ...o,
      name: o.name || `パス ${i + 1}`,
      color: safeColor(o.color),
      settings: { ...defaults },
    }));
    const meshes = makeMeshes(next);
    objects = next;
    selected = 0;
    uvSelectedKey = null;
    uvDragKey = null;
    list();
    sync();
    rebuild(meshes);
    fit();
    if (parsed.warnings?.length) notice(parsed.warnings.join(" / "));
    $("dropzone").classList.add("loaded");
    $("dropzone").querySelector("strong").textContent = name;
  } catch (e) {
    notice(e.message, true);
  }
}
async function read(file) {
  if (!file) return;
  if (!/\.svg$/i.test(file.name)) {
    notice(
      "SVG を選択してください。Illustrator の .ai ファイルは SVG 形式で保存して読み込みます。",
      true,
    );
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    notice("SVG は 5 MB 以下にしてください。", true);
    return;
  }
  await load(await file.text(), file.name);
}
$("file").onchange = (e) => read(e.target.files[0]);
$("dropzone").ondragover = (e) => {
  e.preventDefault();
  $("dropzone").classList.add("dragging");
};
$("dropzone").ondragleave = () => $("dropzone").classList.remove("dragging");
$("dropzone").ondrop = (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("dragging");
  read(e.dataTransfer.files[0]);
};
$("sample").onclick = async () => {
  try {
    const response = await fetch("/sample.svg");
    if (!response.ok) throw new Error("サンプルを取得できません。");
    await load(await response.text(), "sample.svg");
  } catch (e) {
    notice(e.message, true);
  }
};
Object.keys(defaults).forEach((key) => {
  const input = $(key);
  input.oninput = () => {
    const o = selectedObject();
    if (!o) return;
    if (key === "curve") delete o.settings.curvePoints;
    if (input.type === "checkbox") o.settings[key] = input.checked;
    else {
      const n = Number(input.value);
      if (!Number.isFinite(n)) return;
      o.settings[key] = Math.max(
        Number(input.min),
        Math.min(Number(input.max), n),
      );
      const range = document.querySelector(`[data-range="${key}"]`);
      if (range) range.value = o.settings[key];
    }
    const clearedUV = !key.startsWith("uv") && clearShapeUV(o);
    curveDraw();
    rebuild();
    if (clearedUV) notice("形状の変更に伴い UV 頂点修正をクリアしました。");
  };
  const range = document.querySelector(`[data-range="${key}"]`);
  if (range)
    range.oninput = () => {
      input.value = range.value;
      input.oninput();
    };
});
$("color").oninput = () => {
  const o = selectedObject();
  if (!o) return;
  o.color = $("color").value;
  $("color-value").textContent = o.color.toUpperCase();
  list();
  rebuild();
};
$("fit").onclick = fit;
$("reset").onclick = () => {
  const o = selectedObject();
  if (o) {
    o.settings = { ...defaults };
    sync();
    rebuild();
    fit();
  }
};
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").onclick = () => {
  if (!objects.length) {
    notice("先に SVG を読み込んでください。", true);
    return;
  }
  try {
    const meshes = makeMeshes(objects);
    const items = objects.map((o, i) => ({
      name: o.name,
      color: o.color,
      geometry: meshes[i].geometry,
    }));
    try {
      const { obj, mtl } = exportObj(items);
      download(obj, "model.obj", "text/plain");
      download(mtl, "model.mtl", "text/plain");
      notice(
        "model.obj と model.mtl を書き出しました。同じフォルダーに保存してください。",
      );
    } finally {
      meshes.forEach((m) => {
        m.geometry.dispose();
        m.material.dispose();
      });
    }
  } catch (e) {
    notice(e.message, true);
  }
};
let uvSelectedKey = null;
let uvDragKey = null;
let uvPoints = [];
let uvFrame = { x: 20, y: 20, size: 100 };
function clearShapeUV(object) {
  const hadEdits = Object.keys(object.settings.uvEdits || {}).length > 0;
  delete object.settings.uvEdits;
  uvSelectedKey = null;
  return hadEdits;
}
function drawUV() {
  const canvas = $("uv-canvas"),
    ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const w = canvas.width,
    h = canvas.height;
  ctx.fillStyle = "#171b20";
  ctx.fillRect(0, 0, w, h);
  const mesh = group.children[selected],
    uv = mesh?.geometry.getAttribute("uv"),
    keys = mesh?.geometry.userData.uvKeys;
  uvPoints = [];
  let minU = 0,
    minV = 0,
    maxU = 1,
    maxV = 1;
  if (uv)
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
  const size = Math.min(
    (w - 45) / Math.max(1, maxU - minU),
    (h - 35) / Math.max(1, maxV - minV),
  );
  if (uvDragKey === null)
    uvFrame = {
      x: (w - (maxU - minU) * size) / 2 - minU * size,
      y: h - 18 + minV * size,
      size,
    };
  const project = (u, v) => ({
    x: uvFrame.x + u * uvFrame.size,
    y: uvFrame.y - v * uvFrame.size,
  });
  ctx.strokeStyle = "#2b333c";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const a = project(i / 4, 0),
      b = project(i / 4, 1),
      c = project(0, i / 4),
      d = project(1, i / 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
  const origin = project(0, 0),
    top = project(0, 1);
  ctx.strokeStyle = "#687687";
  ctx.strokeRect(top.x, top.y, uvFrame.size, uvFrame.size);
  ctx.fillStyle = "#7f8a98";
  ctx.font = "9px sans-serif";
  ctx.fillText("0, 0", origin.x, origin.y + 12);
  ctx.fillText("1, 1", top.x + uvFrame.size + 4, top.y + 7);
  if (!uv) return;
  const index = mesh.geometry.index,
    count = index ? index.count : uv.count;
  ctx.strokeStyle = "#b6ee7580";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < count; i += 3) {
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      const k = index ? index.getX(i + j) : i + j,
        p = project(uv.getX(k), uv.getY(k));
      j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  const seen = new Set();
  for (let i = 0; i < uv.count; i++) {
    const key = keys?.[i];
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    const p = project(uv.getX(i), uv.getY(i));
    uvPoints.push({ ...p, key });
  }
  if ($("uv-edit-mode").checked)
    for (const p of uvPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.key === uvSelectedKey ? 4 : 2, 0, Math.PI * 2);
      ctx.fillStyle = p.key === uvSelectedKey ? "#ffffff" : "#b6ee75";
      ctx.fill();
    }
}
$("uv-edit-mode").onchange = () => {
  uvDragKey = null;
  $("uv-canvas").classList.toggle("editing", $("uv-edit-mode").checked);
  drawUV();
};
$("uv-clear").onclick = () => {
  const o = selectedObject();
  if (!o) return;
  delete o.settings.uvEdits;
  uvSelectedKey = null;
  rebuild();
  notice("選択オブジェクトの UV 頂点修正をクリアしました。");
};
function uvPointer(e) {
  const rect = $("uv-canvas").getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * $("uv-canvas").width) / rect.width,
    y: ((e.clientY - rect.top) * $("uv-canvas").height) / rect.height,
  };
}
$("uv-canvas").onpointerdown = (e) => {
  if (!$("uv-edit-mode").checked) return;
  const p = uvPointer(e);
  let nearest = null,
    distance = 10;
  for (const point of uvPoints) {
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (d < distance) {
      nearest = point;
      distance = d;
    }
  }
  uvSelectedKey = nearest?.key ?? null;
  uvDragKey = uvSelectedKey;
  if (uvDragKey !== null) $("uv-canvas").setPointerCapture(e.pointerId);
  drawUV();
};
$("uv-canvas").onpointermove = (e) => {
  if (uvDragKey === null) return;
  const o = selectedObject();
  if (!o) return;
  const p = uvPointer(e),
    u = (p.x - uvFrame.x) / uvFrame.size,
    v = (uvFrame.y - p.y) / uvFrame.size,
    s = o.settings,
    angle = (s.uvRotation * Math.PI) / 180,
    c = Math.cos(angle),
    sin = Math.sin(angle),
    x = (u - s.uvOffsetX) / s.uvScaleX,
    y = (v - s.uvOffsetY) / s.uvScaleY;
  s.uvEdits = {
    ...s.uvEdits,
    [uvDragKey]: [x * c + y * sin, -x * sin + y * c],
  };
  rebuild();
};
$("uv-canvas").onpointerup = () => {
  uvDragKey = null;
  drawUV();
};
$("uv-canvas").onpointercancel = () => {
  uvDragKey = null;
  drawUV();
};
new ResizeObserver(() => drawUV()).observe($("uv-canvas"));
function resize() {
  if (!renderer) return;
  const el = $("viewport"),
    w = el.clientWidth,
    h = el.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($("viewport"));
function animate() {
  requestAnimationFrame(animate);
  if (renderer) {
    controls.update();
    renderer.render(scene, camera);
  }
}
animate();
$("sample").click();
