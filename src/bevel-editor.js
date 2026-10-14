import {
  defaultProfile,
  evaluateProfile,
  normalizeProfile,
  moveProfileHandle,
} from "./bevel-profile.js";
export function createBevelEditor(host, { getObject, onChange }) {
  host.classList.add("bevel-editor");
  host.innerHTML = `<div class="curve-header"><label>調整対象 <select id="curve-side"><option value="outer">外側</option><option value="inner">内側</option></select></label><button id="curve-expand">拡大 ↗</button></div><div class="curve-tools"><label>選択頂点 <select id="curve-point-mode"><option value="linear">リニア</option><option value="bezier">ベジェ</option></select></label><label>ハンドル <select id="curve-handle-mode"><option value="free">左右独立</option><option value="aligned">接線</option></select></label></div><svg viewBox="0 0 480 280" tabindex="0" role="group" aria-label="ベベル曲線エディター"></svg><div class="curve-labels"><span>側面 → 表面（高さ）</span><span>ベベル幅 ↑</span></div><p class="curve-help">クリックで頂点追加 · 頂点／ハンドルをドラッグ<br>矢印キーで移動 · Delで削除（両端位置は固定）</p>`;
  const svg = host.querySelector("svg"),
    side = host.querySelector("#curve-side"),
    mode = host.querySelector("#curve-point-mode"),
    handleMode = host.querySelector("#curve-handle-mode");
  svg.setAttribute("preserveAspectRatio", "none");
  let selected = 1,
    objectId = null,
    drag = null;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const hasInner = (o) => Boolean(o && (o.settings.hollow || o.shape?.holes?.length));
  const profileKey = () => side.value === "inner" ? "innerCurvePoints" : "curvePoints";
  const points = () => {
    const settings = getObject()?.settings;
    return normalizeProfile(settings?.[profileKey()] || settings?.curvePoints || defaultProfile());
  };
  const px = (x) => 30 + x * 420,
    py = (y) => 245 - y * 215;
  function coords(e) {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    );
    return { x: clamp((p.x - 30) / 420), y: clamp((245 - p.y) / 215) };
  }
  function save(p) {
    const o = getObject();
    if (!o) return;
    o.settings[profileKey()] = normalizeProfile(p);
    onChange();
    sync();
  }
  function sync() {
    const o = getObject();
    if (objectId !== o?.id) {
      objectId = o?.id;
      selected = 1;
      drag = null;
      side.value = "outer";
    }
    side.disabled = !o;
    side.querySelector('[value="inner"]').disabled = !hasInner(o);
    if (!hasInner(o)) side.value = "outer";
    const p = points();
    selected = clamp(selected, 0, p.length - 1);
    let d = "";
    for (let i = 0; i <= 160; i++) {
      const x = i / 160;
      d += `${i ? "L" : "M"}${px(x)} ${py(evaluateProfile(p, x))} `;
    }
    let drawing = `<path class="curve-grid" d="M30 30V245H450 M30 137.5H450 M240 30V245 M450 30V245 M30 30H450"/><path id="curve-path" class="curve-line" d="${d}"/>`;
    const v = p[selected];
    if (v.mode === "bezier")
      for (const h of ["in", "out"]) {
        if (
          (h === "in" && selected === 0) ||
          (h === "out" && selected === p.length - 1) ||
          !v[h]
        )
          continue;
        drawing += `<line class="curve-handle-line" x1="${px(v.x)}" y1="${py(v.y)}" x2="${px(v[h].x)}" y2="${py(v[h].y)}"/><circle class="curve-handle" data-curve-handle="${h}" cx="${px(v[h].x)}" cy="${py(v[h].y)}" r="6"/>`;
      }
    p.forEach(
      (v, i) =>
        (drawing += `<circle data-curve-point="${i}" class="${i === selected ? "selected " : ""}${i === 0 || i === p.length - 1 ? "endpoint" : ""}" cx="${px(v.x)}" cy="${py(v.y)}" r="7"><title>頂点 ${i + 1}：${v.mode === "bezier" ? "ベジェ" : "リニア"}</title></circle>`),
    );
    svg.innerHTML = drawing;
    handleMode.value = v.handleMode;
    handleMode.disabled =
      !o || v.mode !== "bezier" || selected === 0 || selected === p.length - 1;
    mode.value = v.mode;
    mode.disabled = !o;
  }
  function move(pos) {
    const p = points(),
      v = p[selected];
    if (drag?.handle) {
      save(moveProfileHandle(p, selected, drag.handle, pos));
      return;
    } else {
      if (!selected || selected === p.length - 1) return;
      const x = clamp(
          pos.x,
          p[selected - 1].x + 0.01,
          p[selected + 1].x - 0.01,
        ),
        y = clamp(pos.y),
        dx = x - v.x,
        dy = y - v.y;
      for (const h of ["in", "out"])
        if (v[h]) v[h] = { x: v[h].x + dx, y: v[h].y + dy };
      v.x = x;
      v.y = y;
    }
    save(p);
  }
  function insert(pos) {
    if (!getObject()) return;
    const p = points();
    if (p.length >= 16) return;
    const x = clamp(pos.x, 0.01, 0.99),
      i = p.findIndex((v) => v.x > x);
    if (i < 1 || x - p[i - 1].x < 0.01 || p[i].x - x < 0.01) return;
    p.splice(i, 0, { x, y: clamp(pos.y), mode: "linear" });
    selected = i;
    save(p);
  }
  function remove() {
    const p = points();
    if (!getObject() || !selected || selected === p.length - 1) return;
    p.splice(selected, 1);
    selected = Math.min(selected, p.length - 2);
    save(p);
  }
  side.onchange = () => {
    if (!hasInner(getObject()) && side.value === "inner") side.value = "outer";
    selected = 1;
    drag = null;
    sync();
  };
  handleMode.onchange = () => {
    const p = points();
    p[selected].handleMode = handleMode.value;
    save(p);
    svg.focus();
  };
  mode.onchange = () => {
    const p = points();
    p[selected].mode = mode.value;
    save(p);
    svg.focus();
  };
  svg.onpointerdown = (e) => {
    if (!getObject()) return;
    const hit = e.target.closest("[data-curve-point]"),
      handle = e.target.closest("[data-curve-handle]");
    if (hit) selected = Number(hit.dataset.curvePoint);
    if (!hit && !handle) {
      insert(coords(e));
      svg.focus();
      e.preventDefault();
      return;
    }
    drag = { handle: handle?.dataset.curveHandle };
    svg.setPointerCapture(e.pointerId);
    svg.focus();
    sync();
    e.preventDefault();
  };
  svg.onpointermove = (e) => {
    if (drag) move(coords(e));
  };
  svg.onpointerup = svg.onpointercancel = () => {
    drag = null;
  };
  svg.onkeydown = (e) => {
    if (!getObject()) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove();
      return;
    }
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowDown: [0, -1],
      ArrowUp: [0, 1],
    }[e.key];
    if (!delta) return;
    e.preventDefault();
    const v = points()[selected],
      s = e.shiftKey ? 0.05 : 0.01;
    move({ x: clamp(v.x + delta[0] * s), y: clamp(v.y + delta[1] * s) });
  };
  host.querySelector("#curve-expand").onclick = () => {
    const dialog = document.createElement("dialog");
    dialog.className = "curve-dialog";
    dialog.innerHTML =
      '<div class="curve-dialog-heading"><strong>ベベル曲線を編集</strong><button>閉じる ×</button></div>';
    const marker = document.createComment("bevel-editor");
    host.replaceWith(marker);
    dialog.append(host);
    document.body.append(dialog);
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.addEventListener(
      "close",
      () => {
        marker.replaceWith(host);
        dialog.remove();
        sync();
      },
      { once: true },
    );
    dialog.showModal();
    svg.focus();
  };
  sync();
  return { sync };
}
