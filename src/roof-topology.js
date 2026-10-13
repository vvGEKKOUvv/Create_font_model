export function validateRoofTriangles(triangles, rings) {
  // Validate the sampled surface too: clipping and triangulation can fail even
  // when the skeleton's raw faces pass validation. Compare coordinates as they
  // will be stored in the renderer's Float32 position buffer.
  const pointKey = (p) =>
    `${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(p.height * 1e7)}`;
  const edgeKey = (a, b) => [pointKey(a), pointKey(b)].sort().join("|");
  const boundary = new Set();
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = { ...ring[i], height: 1 },
        b = { ...ring[(i + 1) % ring.length], height: 1 };
      if (pointKey(a) !== pointKey(b)) boundary.add(edgeKey(a, b));
    }
  const incidence = new Map();
  for (const triangle of triangles) {
    const keys = triangle.points.map(pointKey);
    for (let i = 0; i < 3; i++) {
      const a = keys[i],
        b = keys[(i + 1) % 3];
      if (a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      incidence.set(key, (incidence.get(key) || 0) + 1);
    }
  }
  if (
    [...boundary].some((key) => incidence.get(key) !== 1) ||
    [...incidence].some(([key, count]) => count !== (boundary.has(key) ? 1 : 2))
  ) {
    const error = new Error("ベベル面の境界が閉じていません。");
    error.code = "INVALID_BEVEL_TOPOLOGY";
    throw error;
  }
}
