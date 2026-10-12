import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseSvg, buildMesh, exportObj, applyUvSettings } from "./geometry.js";
import { defaultProfile } from "./bevel-profile.js";
import { prepareContours } from "./path-reduction.js";
import { createBevelEditor } from "./bevel-editor.js";
import { createTransformTools, prepareObjectMesh } from "./transform-tools.js";
import { createHistory } from "./history.js";
import "./style.css";

const defaults = {
  reductionTolerance: 0,
  depth: 24,
  bevelSize: 3,
  bevelWidth: 3,
  bevelContinue: true,
  bevelSegments: 5,
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
app.innerHTML = `
<header>
  <a class="brand" href="./"><span class="brand-icon">◈</span> PATH<span class="brand-slash">/</span>FORM</a>
  <span class="header-label">SVG → 3D STUDIO</span>
  <div class="history-actions"><button id="undo" class="subtle" disabled aria-label="元に戻す">↶ 元に戻す</button><button id="redo" class="subtle" disabled aria-label="やり直す">↷ やり直す</button></div>
  <button id="export" class="primary">↓ OBJ を書き出す</button>
</header>
<main>
  <section class="workspace">
    <div class="workspace-tabs" role="tablist" aria-label="編集ビュー">
      <button id="tab-3d" class="active" role="tab" aria-selected="true" aria-controls="view-3d">3D ビューポート</button>
      <button id="tab-uv" role="tab" aria-selected="false" aria-controls="view-uv" tabindex="-1">UV MAP</button>
    </div>
    <div id="view-3d" class="workspace-view" role="tabpanel" aria-labelledby="tab-3d">
      <div class="viewport-heading"><span><i class="live-dot"></i> LIVE PREVIEW</span><label class="wireframe-toggle"><input id="wireframe" type="checkbox"/> ワイヤーフレーム</label><select id="wireframe-mode" aria-label="ワイヤーフレーム表示方式"><option value="lines">線のみ</option><option value="overlay">シェーダーに重ねる</option></select><button id="fit" class="subtle">⊡ 全体表示</button></div>
      <div id="viewport"></div>
      <div class="view-caption"><span id="mesh-info">—</span></div>
    </div>
    <div id="view-uv" class="workspace-view" role="tabpanel" aria-labelledby="tab-uv" hidden>
      <div class="uv-panel">
        <div class="uv-heading"><span>UV MAP <small>展開・調整</small></span><span class="tiny-label">UV 座標を確認</span></div>
        <canvas id="uv-canvas" width="700" height="600" aria-label="UV 展開。頂点編集を有効にして頂点をドラッグ"></canvas>
      </div>
    </div>
    <div id="message" role="status"></div>
  </section>
  <aside class="right-panel" aria-label="オブジェクトと設定">
    <details class="control-section" open>
      <summary>パスの読み込み <span>SOURCE</span></summary>
      <label class="dropzone" id="dropzone">
        <input type="file" id="file" accept=".svg,image/svg+xml" multiple hidden/>
        <span class="upload-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg></span>
        <strong>SVG を追加</strong>
      </label>
    </details>
    <details id="objects-details" class="control-section" open>
      <summary>オブジェクト選択 <span id="object-count">0</span></summary>
      <div id="objects"></div>
      <label class="rename-row"><span>名前</span><input id="object-name" type="text" maxlength="120" aria-label="オブジェクト名" placeholder="選択オブジェクトの名前"/></label>
      <p class="export-visibility-note">非表示のオブジェクトは書き出し対象外</p>
      <div class="selection-heading"><p id="selected-name" class="muted">オブジェクトを選択</p><button id="reset" class="subtle">リセット ↺</button></div>
    </details>
    <details class="control-section" id="reduction-settings" open>
      <summary>パスのリダクション <span>REDUCTION</span></summary>
      ${field("reductionTolerance", "許容誤差", 0, 0, 5, 0.01)}
      <p id="reduction-info" class="control-note">—</p>
    </details>
    <details class="control-section" open>
      <summary>押し出し <span>EXTRUDE</span></summary>
      ${field("depth", "奥行き", 24, 0.01, 100, 0.1)}
    </details>
    <details class="control-section" open>
      <summary>ベベル <span>BEVEL</span></summary>
      ${field("bevelSize", "奥行方向", 3, 0, 12, 0.1)}
      ${field("bevelWidth", "輪郭幅", 3, 0, 100, 0.1)}
      <label class="toggle-row"><span>正面が合流するまで広げる</span><input id="bevelContinue" type="checkbox" checked/><i></i></label>
      ${field("bevelSegments", "分割数", 5, 1, 16, 1)}
      <p id="geometry-status" class="control-note"></p>
      <div class="curve-display"></div>
      <label class="toggle-row"><span>尖った角を保持</span><input id="sharpCorners" type="checkbox" checked/><i></i></label>
    </details>
    <details class="control-section" open>
      <summary>内側をくり抜く <span>HOLLOW</span></summary>
      <label class="toggle-row"><span>中空にする</span><input id="hollow" type="checkbox"/><i></i></label>
      ${field("wallThickness", "壁の厚み", 4, 0.001, 30, 0.01)}
    </details>
    <details class="control-section" open>
      <summary>マテリアル <span>MATERIAL</span></summary>
      <label class="color-row"><input type="color" id="color" value="#b6ee75"/><span id="color-value">#B6EE75</span><span class="muted">カラー</span></label>
    </details>
    <details id="uv-settings" class="control-section" open>
      <summary>UV 設定 <span>UV MAP</span></summary>
      <div class="uv-tools"><label><input type="checkbox" id="uv-edit-mode"/> UV 頂点編集</label><button id="uv-clear" class="subtle">UV 修正をクリア ↺</button><span>頂点をドラッグ · 同じ UV 座標をまとめて編集</span></div>
      <div class="uv-inputs">
        ${field("uvScaleX", "スケール U", 1, 0.01, 20, 0.1, false)}
        ${field("uvScaleY", "スケール V", 1, 0.01, 20, 0.1, false)}
        ${field("uvOffsetX", "移動 U", 0, -20, 20, 0.1, false)}
        ${field("uvOffsetY", "移動 V", 0, -20, 20, 0.1, false)}
        ${field("uvRotation", "回転 °", 0, -360, 360, 1, false)}
      </div>
    </details>
  </aside>
</main>`;
function field(id, label, value, min, max, step, range = true) {
  return `<label class="field ${range ? "" : "compact"}"><span>${label}</span>${range ? `<input data-range="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/>` : ""}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"/></label>`;
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
  controls.dampingFactor = 0.35;
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
let fileSequence = 0;
let objectSequence = 0;
let objects = [],
  selected = 0;
let history = null;
function recordHistory(immediate = false) {
  history?.record();
  if (immediate) history?.commit();
}
const $ = (id) => document.getElementById(id);
function notice(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function selectedObject() {
  return objects[selected];
}
const transformTools = createTransformTools({
  scene,
  camera,
  renderer,
  orbit: controls,
  group,
  getObjects: () => objects,
  getSelected: () => selected,
  onChange: (immediate) => recordHistory(immediate),
  onSelect: (index) => {
    flushPending();
    selected = index;
    uvSelectedKey = null;
    uvDragKey = null;
    list();
    sync();
    drawUV();
    transformTools.sync();
  },
});
const transformControls = transformTools.controls;
function dispose() {
  group.children.slice().forEach((m) => {
    group.remove(m);
    disposeWireframe(m);
    m.geometry.dispose();
    m.material.dispose();
  });
}
function disposeWireframe(mesh) {
  const overlay = mesh.userData.wireframeOverlay;
  if (!overlay) return;
  mesh.remove(overlay);
  overlay.geometry.dispose();
  overlay.material.dispose();
  delete mesh.userData.wireframeOverlay;
}
function applyDisplayStyle(mesh, object) {
  const enabled = $("wireframe").checked;
  const overlayMode = $("wireframe-mode").value === "overlay";
  mesh.visible = object.visible !== false;
  mesh.material.wireframe = enabled && !overlayMode;
  mesh.material.color.set(mesh.material.wireframe ? "#c4d8ef" : object.color);
  mesh.material.polygonOffset = enabled && overlayMode;
  mesh.material.polygonOffsetFactor = 1;
  mesh.material.polygonOffsetUnits = 1;
  let overlay = mesh.userData.wireframeOverlay;
  if (overlay && overlay.userData.sourceGeometry !== mesh.geometry) {
    disposeWireframe(mesh);
    overlay = null;
  }
  if (enabled && overlayMode && !overlay) {
    overlay = new THREE.LineSegments(
      new THREE.WireframeGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: "#17212b", depthWrite: false }),
    );
    overlay.userData.sourceGeometry = mesh.geometry;
    overlay.renderOrder = 1;
    mesh.userData.wireframeOverlay = overlay;
    mesh.add(overlay);
  }
  if (overlay) overlay.visible = enabled && overlayMode;
}
function makeMeshes(entries) {
  const meshes = [];
  try {
    entries.forEach((o) => {
      const geometry = buildMesh(o.shape, o.settings);
      geometry.userData.sourceSettings = structuredClone(o.settings);
      const material = new THREE.MeshStandardMaterial({
        color: o.color,
        roughness: 0.44,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.objectId = o.id;
      prepareObjectMesh(mesh, o);
      applyDisplayStyle(mesh, o);
      meshes.push(mesh);
    });
    return meshes;
  } catch (e) {
    meshes.forEach((m) => {
      disposeWireframe(m);
      m.geometry.dispose();
      m.material.dispose();
    });
    throw e;
  }
}
let pendingObjects = new Set(),
  rebuildTimer = null;
function initialSettings(shape) {
  const points = shape.extractPoints(4).shape;
  const box = new THREE.Box2().setFromPoints(points),
    span = Math.max(
      0.01,
      Math.min(box.max.x - box.min.x, box.max.y - box.min.y),
    );
  const depth = Math.min(defaults.depth, span * 0.3);
  let tolerance = 0;
  try {
    prepareContours(shape, 0);
  } catch (error) {
    if (!/3,000|3000/.test(error.message)) throw error;
    const diagonal = box.getSize(new THREE.Vector2()).length();
    let accepted = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      tolerance = Math.max(1e-6, diagonal * 1e-6) * 4 ** attempt;
      try {
        prepareContours(shape, tolerance);
        accepted = true;
        break;
      } catch (retry) {
        if (!/3,000|3000/.test(retry.message)) throw retry;
      }
    }
    if (!accepted) throw error;
  }
  return {
    ...defaults,
    reductionTolerance: tolerance,
    depth,
    bevelSize: Math.min(defaults.bevelSize, span * 0.04, depth * 0.2),
    bevelWidth: Math.min(defaults.bevelWidth, span * 0.04),
    wallThickness: Math.min(defaults.wallThickness, span * 0.15),
    bevelFullWidth: true,
    curvePoints: [
      { x: 0, y: 0, mode: "linear" },
      { x: 0.5, y: 0.5, mode: "linear" },
      { x: 1, y: 1, mode: "linear" },
    ],
  };
}
function updateGeometryInfo() {
  const data = group.children[selected]?.geometry.userData;
  if (!data) return;
  const before = data.originalCount ?? 0,
    after = data.reducedCount ?? before;
  $("reduction-info").textContent =
    `${before.toLocaleString()} → ${after.toLocaleString()} 頂点（${before ? ((1 - after / before) * 100).toFixed(1) : 0}% 削減）`;
  $("geometry-status").textContent =
    `奥行方向：${Number(data.effectiveBevelDepth || 0).toPrecision(3)} / 輪郭幅：${Number(data.effectiveBevel || 0).toPrecision(3)}` +
    (selectedObject()?.settings.hollow
      ? ` / 壁厚：${Number(data.effectiveWallThickness || 0).toPrecision(3)} / 残る奥行：${Number(data.centralWallDepth ?? 0).toPrecision(3)}`
      : "");
}
function refreshMeshInfo() {
  $("mesh-info").textContent =
    `${objects.length} OBJECTS · ${group.children.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0).toLocaleString()} VERTICES`;
  const warnings = group.children.flatMap(
    (m) => m.geometry.userData.warnings || [],
  );
  notice([...new Set(warnings)].join(" / "));
  updateGeometryInfo();
  drawUV();
}
function rebuildObject(object) {
  const index = objects.indexOf(object);
  if (index < 0) return true;
  try {
    const replacement = makeMeshes([object])[0],
      mesh = group.children[index];
    const oldGeometry = mesh.geometry;
    mesh.geometry = replacement.geometry;
    applyDisplayStyle(mesh, object);
    mesh.position.copy(replacement.position);
    mesh.rotation.copy(replacement.rotation);
    mesh.scale.copy(replacement.scale);
    mesh.updateMatrix();
    disposeWireframe(replacement);
    replacement.material.dispose();
    oldGeometry.dispose();
    object.invalid = false;
    syncBevelLimit();
    refreshMeshInfo();
    return true;
  } catch (e) {
    object.invalid = true;
    notice(e.message, true);
    return false;
  }
}
function flushPending() {
  clearTimeout(rebuildTimer);
  rebuildTimer = null;
  const queued = [...pendingObjects];
  pendingObjects.clear();
  let valid = true;
  for (const object of queued) if (!rebuildObject(object)) valid = false;
  return valid;
}
function scheduleRebuild(object = selectedObject()) {
  if (!object) return;
  pendingObjects.add(object);
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(flushPending, 70);
}
function rebuild(prepared) {
  if (!prepared) {
    const object = selectedObject();
    pendingObjects.delete(object);
    return object ? rebuildObject(object) : true;
  }
  transformTools.detach();
  dispose();
  prepared.forEach((m) => group.add(m));
  group.position.set(0, 0, 0);
  group.position.sub(
    new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()),
  );
  transformTools.sync();
  refreshMeshInfo();
  return true;
}
function updateUV(object = selectedObject()) {
  const index = objects.indexOf(object),
    mesh = group.children[index];
  if (!mesh) return;
  try {
    applyUvSettings(mesh.geometry, object.settings);
    drawUV();
  } catch (e) {
    notice(e.message, true);
  }
}
function fit() {
  if (!group.children.length) return;
  const box = new THREE.Box3();
  group.updateMatrixWorld(true);
  group.children
    .filter((mesh) => mesh.visible)
    .forEach((mesh) => box.expandByObject(mesh));
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()),
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
      (
        o,
        i,
      ) => `<div class="object-entry ${o.visible === false ? "object-hidden" : ""}">
      <button class="object-row ${selected === i ? "active" : ""}" data-object="${i}"><i style="background:${safeColor(o.color)}"></i><span>${escapeHTML(o.name)}</span><small title="${escapeHTML(o.sourceName || "")}">${escapeHTML(o.sourceName || "")}</small></button>
      <button class="object-visibility" data-visibility="${i}" aria-label="${escapeHTML(o.name)}を${o.visible === false ? "表示" : "非表示"}" aria-pressed="${o.visible !== false}" title="${o.visible === false ? "表示する" : "非表示にする"}">${o.visible === false ? "○" : "◉"}</button>
    </div>`,
    )
    .join("");
  document.querySelectorAll("[data-visibility]").forEach((button) => {
    button.onclick = () => {
      flushPending();
      const index = Number(button.dataset.visibility);
      const object = objects[index];
      object.visible = object.visible === false;
      recordHistory(true);
      applyDisplayStyle(group.children[index], object);
      list();
      transformTools.sync();
    };
  });
  document.querySelectorAll("[data-object]").forEach(
    (el) =>
      (el.onclick = () => {
        flushPending();
        selected = Number(el.dataset.object);
        uvSelectedKey = null;
        uvDragKey = null;
        list();
        sync();
        transformTools.sync();
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
  $("object-name").value = o.name;
  Object.keys(defaults).forEach((key) => {
    const el = $(key);
    if (el.type === "checkbox") el.checked = o.settings[key];
    else el.value = o.settings[key];
    const range = document.querySelector(`[data-range="${key}"]`);
    if (range) range.value = o.settings[key];
  });
  $("color").value = safeColor(o.color);
  $("color-value").textContent = o.color.toUpperCase();
  syncBevelLimit();
  curveDraw();
  updateGeometryInfo();
}
const bevelEditor = createBevelEditor(
  document.querySelector(".curve-display"),
  {
    getObject: selectedObject,
    onChange: () => {
      const o = selectedObject();
      if (!o) return;
      const cleared = clearShapeUV(o);
      scheduleRebuild(o);
      recordHistory();
      if (cleared) notice("形状の変更に伴い UV 頂点修正をクリアしました。");
    },
  },
);
function curveDraw() {
  bevelEditor.sync();
}
async function load(text, name) {
  try {
    const parsed = parseSvg(text),
      source = ++fileSequence;
    const next = parsed.objects.map((o, i) => ({
      ...o,
      id: `file-${source}-${o.id}`,
      sourceName: name,
      name: `${o.name || "パス"} ${String(++objectSequence).padStart(3, "0")}`,
      visible: true,
      color: safeColor(o.color),
      settings: initialSettings(o.shape),
    }));
    const meshes = makeMeshes(next);
    flushPending();
    const first = objects.length === 0,
      index = objects.length;
    objects.push(...next);
    selected = index;
    uvSelectedKey = null;
    uvDragKey = null;
    meshes.forEach((mesh) => group.add(mesh));
    if (first) {
      group.position.set(0, 0, 0);
      group.position.sub(
        new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()),
      );
      fit();
    }
    list();
    sync();
    transformTools.sync();
    refreshMeshInfo();
    if (parsed.warnings.length) notice(parsed.warnings.join(" / "));
    $("dropzone").classList.add("loaded");
    $("dropzone").querySelector("strong").textContent = name;
    recordHistory(true);
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
let importQueue = Promise.resolve();
function enqueueFiles(files) {
  const added = Array.from(files);
  importQueue = importQueue
    .then(async () => {
      for (const file of added) await read(file);
    })
    .catch((e) => notice(e.message, true));
}
$("file").onchange = (e) => {
  enqueueFiles(e.target.files);
  e.target.value = "";
};
$("dropzone").ondragover = (e) => {
  e.preventDefault();
  $("dropzone").classList.add("dragging");
};
$("dropzone").ondragleave = () => $("dropzone").classList.remove("dragging");
$("dropzone").ondrop = (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("dragging");
  enqueueFiles(e.dataTransfer.files);
};
function syncBevelLimit() {
  const o = selectedObject();
  if (!o) return;
  $("sharpCorners").disabled = o.settings.bevelContinue;
  $("sharpCorners").title = o.settings.bevelContinue
    ? "合流モードでは角と稜線を保持します"
    : "";
  const widthMaximum = Math.max(
    o.settings.bevelWidth,
    group.children[selected]?.geometry.userData.maximumBevelWidth || 100,
  );
  for (const el of [
    $("bevelWidth"),
    document.querySelector('[data-range="bevelWidth"]'),
  ]) {
    el.max = widthMaximum;
    el.step = Math.max(0.000001, widthMaximum / 1000);
    el.value = o.settings.bevelWidth;
  }
  const maximum = o.settings.depth / 2;
  o.settings.bevelSize = Math.min(o.settings.bevelSize, maximum);
  for (const el of [
    $("bevelSize"),
    document.querySelector('[data-range="bevelSize"]'),
  ]) {
    el.max = maximum;
    el.step = maximum / 1000;
    el.value = o.settings.bevelSize;
  }
}
Object.keys(defaults).forEach((key) => {
  const input = $(key);
  input.oninput = () => {
    const o = selectedObject();
    if (!o) return;
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
    if (key === "depth" || key === "bevelContinue") syncBevelLimit();
    const clearedUV = !key.startsWith("uv") && clearShapeUV(o);
    if (key.startsWith("uv")) {
      updateUV(o);
    } else {
      scheduleRebuild(o);
    }
    recordHistory();
    if (clearedUV) notice("形状の変更に伴い UV 頂点修正をクリアしました。");
  };
  input.onchange = flushPending;
  const range = document.querySelector(`[data-range="${key}"]`);
  if (range) {
    range.onchange = flushPending;
  }
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
  recordHistory();
  $("color-value").textContent = o.color.toUpperCase();
  list();
  const mesh = group.children[selected];
  if (mesh) applyDisplayStyle(mesh, o);
};
$("wireframe").onchange = () =>
  group.children.forEach((mesh, index) =>
    applyDisplayStyle(mesh, objects[index]),
  );
$("wireframe-mode").onchange = $("wireframe").onchange;
$("object-name").onchange = () => {
  const object = selectedObject();
  if (!object) return;
  const name = $("object-name").value.trim();
  if (!name) {
    $("object-name").value = object.name;
    return;
  }
  object.name = name;
  recordHistory(true);
  list();
  sync();
};
$("fit").onclick = fit;
$("reset").onclick = () => {
  const o = selectedObject();
  if (o) {
    o.settings = initialSettings(o.shape);
    recordHistory(true);
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
    if (!flushPending() || objects.some((o) => o.invalid))
      throw new Error(
        "生成できない設定があります。表示中のエラーを解消してから書き出してください。",
      );
    const items = objects.flatMap((o, i) => {
      if (o.visible === false) return [];
      const mesh = group.children[i];
      mesh.updateMatrix();
      return [
        {
          name: o.name,
          color: o.color,
          geometry: mesh.geometry,
          matrix: mesh.matrix,
        },
      ];
    });
    if (!items.length) throw new Error("表示中のオブジェクトがありません。");
    const { obj, mtl } = exportObj(items);
    download(obj, "model.obj", "text/plain");
    download(mtl, "model.mtl", "text/plain");
    notice(
      "model.obj と model.mtl を書き出しました。同じフォルダーに保存してください。",
    );
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
  if (rect.width < 1 || rect.height < 1) return;
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
  recordHistory(true);
  uvSelectedKey = null;
  updateUV(o);
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
  updateUV(o);
  recordHistory();
};
$("uv-canvas").onpointerup = () => {
  history?.commit();
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
  if (w < 1 || h < 1) return;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($("viewport"));
let activeView = "3d";
function activateView(view, focus = false) {
  activeView = view;
  uvDragKey = null;
  for (const name of ["3d", "uv"]) {
    const active = name === view,
      tab = $(`tab-${name}`);
    $(`view-${name}`).hidden = !active;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }
  if (transformControls) transformControls.enabled = view === "3d";
  if (controls) controls.enabled = view === "3d";
  requestAnimationFrame(() => {
    resize();
    drawUV();
  });
}
for (const view of ["3d", "uv"]) {
  const tab = $(`tab-${view}`);
  tab.onclick = () => activateView(view);
  tab.onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      activateView(
        e.key === "Home"
          ? "3d"
          : e.key === "End"
            ? "uv"
            : activeView === "3d"
              ? "uv"
              : "3d",
        true,
      );
    }
  };
}
function animate() {
  requestAnimationFrame(animate);
  if (renderer) {
    controls.update();
    if (activeView === "3d") {
      renderer.render(scene, camera);
    }
  }
}
function copyObjectState(object) {
  const { shape, ...state } = object;
  return { ...structuredClone(state), shape };
}
function captureHistory() {
  return {
    objects: objects.map((object, index) => ({
      ...copyObjectState(object),
      validSettings: structuredClone(
        group.children[index]?.geometry.userData.sourceSettings ||
          object.settings,
      ),
    })),
    selected,
    groupPosition: group.position.toArray(),
    sourceLabel: $("dropzone").querySelector("strong").textContent,
  };
}
function restoreHistory(snapshot) {
  clearTimeout(rebuildTimer);
  rebuildTimer = null;
  pendingObjects.clear();
  const restored = snapshot.objects.map(copyObjectState);
  const prepared = [];
  let error = "";
  try {
    restored.forEach((object) => {
      const validSettings = object.validSettings;
      delete object.validSettings;
      try {
        prepared.push(...makeMeshes([object]));
        object.invalid = false;
      } catch (failure) {
        const desired = object.settings;
        object.settings = validSettings;
        prepared.push(...makeMeshes([object]));
        object.settings = desired;
        object.invalid = true;
        error = failure.message;
      }
    });
  } catch (failure) {
    prepared.forEach((mesh) => {
      disposeWireframe(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    throw failure;
  }
  transformTools.detach();
  dispose();
  objects = restored;
  selected = Math.min(snapshot.selected, Math.max(0, objects.length - 1));
  prepared.forEach((mesh) => group.add(mesh));
  group.position.fromArray(snapshot.groupPosition);
  uvSelectedKey = null;
  uvDragKey = null;
  $("dropzone").classList.toggle("loaded", objects.length > 0);
  $("dropzone").querySelector("strong").textContent = snapshot.sourceLabel;
  list();
  sync();
  transformTools.sync();
  refreshMeshInfo();
  if (!objects.length) {
    $("selected-name").textContent = "オブジェクトを選択";
    $("object-name").value = "";
    $("object-name").disabled = true;
  }
  if (error) notice(error, true);
}
history = createHistory({
  capture: captureHistory,
  restore: restoreHistory,
  fingerprint: (snapshot) =>
    JSON.stringify(snapshot, (key, value) =>
      ["shape", "selected", "validSettings", "invalid"].includes(key)
        ? undefined
        : value,
    ),
  onChange: () => {
    $("undo").disabled = !history.canUndo;
    $("redo").disabled = !history.canRedo;
  },
});
function travelHistory(direction) {
  flushPending();
  try {
    history[direction]();
  } catch (error) {
    notice(error.message, true);
  }
}
$("undo").onclick = () => travelHistory("undo");
$("redo").onclick = () => travelHistory("redo");
window.addEventListener("change", () => {
  if (history.pending) history.commit();
});
window.addEventListener("pointerup", () => {
  if (history.pending) history.commit();
});
window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && !(key === "y" && event.ctrlKey)) return;
  // Text fields retain the browser's own text undo; buttons handle model undo.
  if (event.target.closest("input,textarea,select,[contenteditable=true]"))
    return;
  event.preventDefault();
  travelHistory(key === "y" || event.shiftKey ? "redo" : "undo");
});
animate();
transformTools.sync();
refreshMeshInfo();
