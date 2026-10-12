const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
export function defaultProfile() {
  return [
    { x: 0, y: 0, mode: "linear" },
    {
      x: 0.5,
      y: 0.4,
      mode: "bezier",
      in: { x: 0.3, y: 0.15 },
      out: { x: 0.7, y: 0.65 },
    },
    { x: 1, y: 1, mode: "linear" },
  ];
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
    p.in = i ? handle(p.in, points[i - 1], p, 2 / 3) : { x: p.x, y: p.y };
    p.out =
      i < points.length - 1
        ? handle(p.out, p, points[i + 1], 1 / 3)
        : { x: p.x, y: p.y };
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
        if (a.mode === "bezier" && b.mode === "bezier")
          left[axis] = right[axis] = (left[axis] + right[axis]) / 2;
        else if (a.mode === "bezier") left[axis] = right[axis];
        else right[axis] = left[axis];
      }
  }
  return points;
}
const cubic = (a, b, c, d, t) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};
export function evaluateProfile(points, x) {
  x = clamp(x, 0, 1);
  if (x <= points[0].x) return points[0].y;
  if (x >= points.at(-1).x) return points.at(-1).y;
  const index = points.findIndex((p) => p.x >= x),
    a = points[index - 1],
    b = points[index];
  if (a.mode !== "bezier" && b.mode !== "bezier")
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
