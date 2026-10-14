export function validateRoofTriangles(triangles, rings) {
  // Validate the sampled surface too: clipping and triangulation can fail even
  // when the skeleton's raw faces pass validation. Compare coordinates as they
  // will be stored in the renderer's Float32 position buffer.
  const ids = new Map();
  const pointIds = new WeakMap();
  let nextId = 0;
  const pointId = (p, height = p.height) => {
    if (height === p.height && pointIds.has(p)) return pointIds.get(p);
    const key = `${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(height * 1e7)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = nextId++;
      ids.set(key, id);
    }
    if (height === p.height) pointIds.set(p, id);
    return id;
  };
  // Integer IDs preserve exactly the same Float32 seam comparisons while
  // avoiding repeated coordinate strings and sorting for every triangle edge.
  const stride =
    triangles.length * 3 + rings.reduce((n, ring) => n + ring.length, 0) + 1;
  const numericEdges = stride * stride <= Number.MAX_SAFE_INTEGER;
  const edgeKey = (a, b) => {
    if (a > b) [a, b] = [b, a];
    return numericEdges ? a * stride + b : `${a}|${b}`;
  };
  const boundary = new Set();
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = pointId(ring[i], 1),
        b = pointId(ring[(i + 1) % ring.length], 1);
      if (a !== b) boundary.add(edgeKey(a, b));
    }
  const incidence = new Map();
  for (const triangle of triangles) {
    const keys = triangle.points.map((p) => pointId(p));
    for (let i = 0; i < 3; i++) {
      const a = keys[i],
        b = keys[(i + 1) % 3];
      if (a === b) continue;
      const key = edgeKey(a, b);
      incidence.set(key, (incidence.get(key) || 0) + 1);
    }
  }
  let invalid = false;
  for (const key of boundary)
    if (incidence.get(key) !== 1) {
      invalid = true;
      break;
    }
  if (!invalid)
    for (const [key, count] of incidence)
      if (count !== (boundary.has(key) ? 1 : 2)) {
        invalid = true;
        break;
      }
  if (invalid) {
    const error = new Error("ベベル面の境界が閉じていません。");
    error.code = "INVALID_BEVEL_TOPOLOGY";
    throw error;
  }
}
