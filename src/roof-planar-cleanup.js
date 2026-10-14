import cdt2d from "cdt2d";

// A clipped face band is planar. Its old triangulation diagonals are not
// constraints: preserve its boundary and discard interior clipping vertices.
// An optional predicate additionally permits removing generated collinear seam
// points; callers must protect source/ridge anchors and apply it to both bands.
export function cleanupPlanarPatch(triangles, removableBoundary = () => false) {
  if (triangles.length < 3) return triangles;
  const points = [], ids = new Map(), edges = new Map();
  const id = (p) => {
    // Match the renderer/topology validator, never move the retained point.
    const key = `${Math.fround(p.x)},${Math.fround(p.y)},${Math.round(p.height * 1e7)}`;
    if (!ids.has(key)) { ids.set(key, points.length); points.push(p); }
    return ids.get(key);
  };
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const tri of triangles) {
    const vertices = tri.points.map(id);
    for (let i = 0; i < 3; i++) {
      const a = vertices[i], b = vertices[(i + 1) % 3];
      if (a === b) return triangles;
      const key = edgeKey(a, b), entry = edges.get(key);
      if (entry) entry.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  }
  if ([...edges.values()].some((e) => e.count > 2)) return triangles;
  // Re-triangulation is safe only when every old vertex lies on one plane.
  // Choose a well-conditioned triangle rather than a narrow clipping sliver.
  let plane, largestArea = 0;
  for (const { points: [a, b, c] } of triangles) {
    const dx = b.x-a.x, dy = b.y-a.y, ex = c.x-a.x, ey = c.y-a.y;
    const cross = dx*ey-dy*ex;
    if (Math.abs(cross) <= largestArea) continue;
    largestArea = Math.abs(cross);
    plane = { a, x: ((b.height-a.height)*ey-(c.height-a.height)*dy)/cross,
      y: (dx*(c.height-a.height)-ex*(b.height-a.height))/cross };
  }
  if (!plane || points.some(p => Math.abs(p.height-plane.a.height-
      plane.x*(p.x-plane.a.x)-plane.y*(p.y-plane.a.y)) > 1e-9)) return triangles;
  let boundary = [...edges.values()].filter((e) => e.count === 1);
  // Adjacent bands use the same protected face-edge intersections, so both
  // remove the same artificial diagonal cut points on their common seam.
  let changed = true;
  while (changed) {
    changed = false;
    const adjacency = new Map();
    boundary.forEach((edge, i) => { for (const v of [edge.a, edge.b]) {
      if (!adjacency.has(v)) adjacency.set(v, []);
      adjacency.get(v).push(i);
    }});
    for (const [v, incident] of adjacency) {
      if (incident.length !== 2 || !removableBoundary(points[v])) continue;
      const [e1,e2] = incident.map(i => boundary[i]);
      const a = e1.a === v ? e1.b : e1.a, b = e2.a === v ? e2.b : e2.a;
      const p=points[a], q=points[v], r=points[b];
      const cross=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
      const scale=Math.hypot(r.x-p.x,r.y-p.y);
      if (!scale || Math.abs(cross) > scale * scale * 1e-12) continue;
      if ((q.x-p.x)*(q.x-r.x)+(q.y-p.y)*(q.y-r.y) > 0) continue;
      boundary=boundary.filter((_,i)=>!incident.includes(i));
      boundary.push({a,b,count:1}); changed=true; break;
    }
  }
  const retained = [...new Set(boundary.flatMap((e) => [e.a, e.b]))];
  // Avoid CDT cost when there is nothing to remove.
  if (retained.length === points.length) return triangles;
  const degrees = new Map();
  for (const e of boundary) for (const v of [e.a, e.b]) degrees.set(v, (degrees.get(v) || 0) + 1);
  if ([...degrees.values()].some((n) => n !== 2)) return triangles;
  const remap = new Map(retained.map((v, i) => [v, i]));
  const kept = retained.map((i) => points[i]);
  let cells;
  try {
    cells = cdt2d(kept.map((p) => [p.x, p.y]), boundary.map((e) => [remap.get(e.a), remap.get(e.b)]), { exterior: false });
  } catch { return triangles; }
  if (!cells.length || cells.length >= triangles.length) return triangles;
  const result = cells.map((cell) => {
    const tri = cell.map((i) => kept[i]);
    if ((tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x) < 0) tri.reverse();
    return { ...triangles[0], points: tri };
  });
  // A self-touching patch or numerical ambiguity must preserve the old mesh.
  const area = (ts) => ts.reduce((sum, t) => {
    const [a, b, c] = t.points;
    return sum + Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
  }, 0);
  if (Math.abs(area(result) - area(triangles)) > Math.max(1e-12, area(triangles) * 1e-10)) return triangles;
  const outputEdges = new Map();
  for (const t of result) {
    const vs = t.points.map(id);
    for (let i = 0; i < 3; i++) {
      const k = edgeKey(vs[i], vs[(i+1)%3]);
      outputEdges.set(k, (outputEdges.get(k) || 0) + 1);
    }
  }
  const boundaryKeys = new Set(boundary.map(e => edgeKey(e.a,e.b)));
  if ([...boundaryKeys].some(key => outputEdges.get(key) !== 1)) return triangles;
  if ([...outputEdges].some(([key, count]) => count !== (boundaryKeys.has(key) ? 1 : 2))) return triangles;
  return result;
}
