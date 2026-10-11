import {
  defaultProfile,
  evaluateProfile,
  normalizeProfile,
} from "./bevel-profile.js";
export function createBevelEditor(host, { getObject, onChange }) {
  host.classList.add("bevel-editor");
  host.innerHTML = `<div class="curve-tools"><button id="curve-add">＋ 頂点を追加</button><button id="curve-delete">頂点を削除</button><button id="curve-expand">拡大 ↗</button><label>選択頂点 <select id="curve-point-mode"><option value="linear">リニア</option><option value="bezier">ベジェ</option></select></label></div><svg viewBox="0 0 480 280" tabindex="0" role="group" aria-label="ベベル曲線エディター"></svg><div class="curve-labels"><span>側面 → 表面（高さ）</span><span>ベベル幅 ↑</span></div><p class="curve-help">ダブルクリックで頂点追加 · 頂点／ハンドルをドラッグ<br>矢印キーで移動 · Deleteで削除（両端位置は固定）</p>`;
  const svg = host.querySelector("svg"),
    mode = host.querySelector("select"),
    add = host.querySelector("#curve-add"),
    del = host.querySelector("#curve-delete");
  svg.setAttribute('preserveAspectRatio', 'none');
  let selected = 1,
    objectId = null,
    drag = null;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const points = () =>
    normalizeProfile(getObject()?.settings.curvePoints || defaultProfile());
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
    o.settings.curvePoints = normalizeProfile(p);
    onChange();
    sync();
  }
  function sync() {
    const o = getObject();
    if (objectId !== o?.id) {
      objectId = o?.id;
      selected = 1;
      drag = null;
    }
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
    mode.value = v.mode;
    mode.disabled = !o;
    add.disabled = !o || p.length >= 16;
    del.disabled = !o || selected === 0 || selected === p.length - 1;
  }
  function move(pos) {
    const p = points(),
      v = p[selected];
    if (drag?.handle) {
      const h = drag.handle;
      v[h] = {
        x: clamp(
          pos.x,
          h === "in" ? p[selected - 1].x : v.x,
          h === "out" ? p[selected + 1].x : v.x,
        ),
        y: pos.y,
      };
    } else {
      if (!selected || selected === p.length - 1) return;
      const x = clamp(
          pos.x,
          p[selected - 1].x + 0.01,
          p[selected + 1].x - 0.01,
        ),
        y = clamp(pos.y, p[selected - 1].y, p[selected + 1].y),
        dx = x - v.x,
        dy = y - v.y;
      for (const h of ["in", "out"])
        if (v[h]) v[h] = { x: v[h].x + dx, y: clamp(v[h].y + dy) };
      v.x = x;
      v.y = y;
    }
    save(p);
  }
  function insert(pos) {
    if (!getObject()) return;
    const p = points();
    if (p.length >= 16) return;
    if (!pos) {
      let s = 0;
      for (let i = 1; i < p.length - 1; i++)
        if (p[i + 1].x - p[i].x > p[s + 1].x - p[s].x) s = i;
      const x = (p[s].x + p[s + 1].x) / 2;
      pos = { x, y: evaluateProfile(p, x) };
    }
    const x = clamp(pos.x, 0.01, 0.99),
      i = p.findIndex((v) => v.x > x);
    if (i < 1 || x - p[i - 1].x < 0.01 || p[i].x - x < 0.01) return;
    p.splice(i, 0, { x, y: clamp(pos.y, p[i - 1].y, p[i].y), mode: "linear" });
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
  add.onclick = () => insert();
  del.onclick = remove;
  mode.onchange = () => {
    const p = points();
    p[selected].mode = mode.value;
    save(p);
  };
  svg.ondblclick = (e) => {
    if (!e.target.closest("[data-curve-handle]")) insert(coords(e));
  };
  svg.onpointerdown = (e) => {
    if (!getObject()) return;
    const hit = e.target.closest("[data-curve-point]"),
      handle = e.target.closest("[data-curve-handle]");
    if (hit) selected = Number(hit.dataset.curvePoint);
    if (!hit && !handle) return;
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
