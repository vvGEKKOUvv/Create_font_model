const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
function boundedHandle(p, ux, uy, length, lowX, highX) {
  let distance = Math.max(0, length);
  if (ux > 0) distance = Math.min(distance, (highX - p.x) / ux);
  if (ux < 0) distance = Math.min(distance, (lowX - p.x) / ux);
  if (uy > 0) distance = Math.min(distance, (1 - p.y) / uy);
  if (uy < 0) distance = Math.min(distance, -p.y / uy);
  return { x: p.x + ux * distance, y: p.y + uy * distance };
}
function shortenHandle(p, name, x) {
  const h = p[name];
  if (p.handleMode !== "aligned") {
    h.x = x;
    return;
  }
  const t =
    Math.abs(h.x - p.x) > 1e-12 ? clamp((x - p.x) / (h.x - p.x), 0, 1) : 0;
  h.x = mix(p.x, h.x, t);
  h.y = mix(p.y, h.y, t);
}
export function moveProfileHandle(input, index, name, pos) {
  const points = normalizeProfile(input),
    p = points[index];
  if (
    !p ||
    !["in", "out"].includes(name) ||
    (name === "in" && index === 0) ||
    (name === "out" && index === points.length - 1)
  )
    return points;
  const low = name === "in" ? points[index - 1].x : p.x;
  const high = name === "out" ? points[index + 1].x : p.x;
  p[name] = {
    x: clamp(Number(pos.x), low, high),
    y: clamp(Number(pos.y), 0, 1),
  };
  if (p.handleMode === "aligned" && index > 0 && index < points.length - 1) {
    const other = name === "in" ? "out" : "in";
    const length = Math.hypot(p[other].x - p.x, p[other].y - p.y);
    const dx = p[name].x - p.x,
      dy = p[name].y - p.y,
      distance = Math.hypot(dx, dy);
    if (distance > 1e-12)
      p[other] = boundedHandle(
        p,
        -dx / distance,
        -dy / distance,
        length,
        other === "in" ? points[index - 1].x : p.x,
        other === "out" ? points[index + 1].x : p.x,
      );
  }
  return normalizeProfile(points);
}
export function defaultProfile() {
  return normalizeProfile([0, 0.5, 1].map((x) => ({
    x, y: x, mode: "bezier", handleMode: "aligned",
  })));
}
export function normalizeProfile(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 16)
    throw new Error(
      "ベベルカーブの頂点は両端を含めて 2〜16 個にしてください。",
    );
  const points = input
    .map((p) => ({
      ...p,
      x: Number(p?.x),
      y: Number(p?.y),
      mode: p?.mode ?? "linear",
      handleMode: p?.handleMode === "aligned" ? "aligned" : "free",
    }))
    .sort((a, b) => a.x - b.x);
  if (
    points.some(
      (p, i) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1 ||
        !["linear", "bezier"].includes(p.mode) ||
        (i && p.x <= points[i - 1].x),
    ) ||
    Math.abs(points[0].x) > 1e-7 ||
    Math.abs(points[0].y) > 1e-7 ||
    Math.abs(points.at(-1).x - 1) > 1e-7 ||
    Math.abs(points.at(-1).y - 1) > 1e-7
  )
    throw new Error(
      "ベベルカーブは両端 (0,0)・(1,1) と高さ順の頂点と 0〜1 の範囲が必要です。",
    );
  points[0].x = points[0].y = 0;
  points.at(-1).x = points.at(-1).y = 1;
  const handle = (raw, a, b, fraction) => {
    if (
      raw &&
      (!Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y)))
    )
      throw new Error("ベジェハンドルには有限の数値を指定してください。");
    return {
      x: clamp(raw ? Number(raw.x) : mix(a.x, b.x, fraction), a.x, b.x),
      y: clamp(raw ? Number(raw.y) : mix(a.y, b.y, fraction), 0, 1),
    };
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const rawIn = p.in,
      rawOut = p.out;
    p.in = i ? handle(p.in, points[i - 1], p, 2 / 3) : { x: p.x, y: p.y };
    p.out =
      i < points.length - 1
        ? handle(p.out, p, points[i + 1], 1 / 3)
        : { x: p.x, y: p.y };
    if (p.handleMode === "aligned" && i > 0 && i < points.length - 1) {
      const a = rawIn || p.in,
        b = rawOut || p.out;
      const dx = Number(b.x) - p.x,
        dy = Number(b.y) - p.y;
      const fallbackX = p.x - Number(a.x),
        fallbackY = p.y - Number(a.y);
      const length = Math.hypot(dx, dy),
        fallbackLength = Math.hypot(fallbackX, fallbackY);
      const ux =
        length > 1e-12
          ? dx / length
          : fallbackLength > 1e-12
            ? fallbackX / fallbackLength
            : 1;
      const uy =
        length > 1e-12
          ? dy / length
          : fallbackLength > 1e-12
            ? fallbackY / fallbackLength
            : 0;
      p.in = boundedHandle(
        p,
        -ux,
        -uy,
        Math.hypot(Number(a.x) - p.x, Number(a.y) - p.y),
        points[i - 1].x,
        p.x,
      );
      p.out = boundedHandle(p, ux, uy, length, p.x, points[i + 1].x);
    }
  }
  // Ordered x controls keep height invertible; y may form recessed profiles.
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    const left =
      a.mode === "bezier"
        ? a.out
        : { x: mix(a.x, b.x, 1 / 3), y: mix(a.y, b.y, 1 / 3) };
    const right =
      b.mode === "bezier"
        ? b.in
        : { x: mix(a.x, b.x, 2 / 3), y: mix(a.y, b.y, 2 / 3) };
    for (const axis of ["x"])
      if (left[axis] > right[axis]) {
        if (a.mode === "bezier" && b.mode === "bezier") {
          const target = (left[axis] + right[axis]) / 2;
          shortenHandle(a, "out", target);
          shortenHandle(b, "in", target);
        } else if (a.mode === "bezier") shortenHandle(a, "out", right[axis]);
        else shortenHandle(b, "in", left[axis]);
      }
  }
  return points;
}
const cubic = (a, b, c, d, t) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};
export function profileSpanIsStraight(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const onChord = (p) => Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) <= 1e-12;
  return (a.mode !== "bezier" || onChord(a.out)) &&
    (b.mode !== "bezier" || onChord(b.in));
}
export function evaluateProfile(points, x) {
  x = clamp(x, 0, 1);
  if (x <= points[0].x) return points[0].y;
  if (x >= points.at(-1).x) return points.at(-1).y;
  const index = points.findIndex((p) => p.x >= x),
    a = points[index - 1],
    b = points[index];
  if (profileSpanIsStraight(a, b))
    return mix(a.y, b.y, (x - a.x) / (b.x - a.x));
  const c =
    a.mode === "bezier"
      ? a.out
      : { x: mix(a.x, b.x, 1 / 3), y: mix(a.y, b.y, 1 / 3) };
  const d =
    b.mode === "bezier"
      ? b.in
      : { x: mix(a.x, b.x, 2 / 3), y: mix(a.y, b.y, 2 / 3) };
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(a.x, c.x, d.x, b.x, mid) < x) lo = mid;
    else hi = mid;
  }
  return cubic(a.y, c.y, d.y, b.y, (lo + hi) / 2);
}
