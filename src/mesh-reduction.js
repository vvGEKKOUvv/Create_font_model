import { BufferGeometry, Float32BufferAttribute } from 'three';

// Input remains owned by the caller. Zero returns it unchanged; a positive
// amount returns a separate geometry, even when constraints prevent collapse.
export function reduceMeshGeometry(geometry, percentage = 0) {
  const amount = Number(percentage);
  if (!Number.isFinite(amount) || amount < 0 || amount > 90)
    throw new Error('メッシュの削減率は 0〜90 の範囲で指定してください。');
  if (!amount) return geometry;
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  if (geometry.index) {
    source.userData = { ...geometry.userData };
    if (geometry.userData.baseUVs) source.userData.baseUVs = Float64Array.from(Array.from(geometry.index.array).flatMap(i => [geometry.userData.baseUVs[i * 2], geometry.userData.baseUVs[i * 2 + 1]]));
    if (geometry.userData.uvKeys) source.userData.uvKeys = Array.from(geometry.index.array, i => geometry.userData.uvKeys[i]);
  }
  const positions = source.getAttribute('position'), uv = source.getAttribute('uv');
  const normal = source.getAttribute('normal');
  const base = source.userData.baseUVs ?? uv?.array;
  const vertices = [], lookup = new Map(), faces = [];
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    if (!p.every(Number.isFinite)) throw new Error('メッシュに不正な座標があります。');
    const key = p.join(',');
    let id = lookup.get(key);
    if (id === undefined) { id = vertices.length; lookup.set(key, id); vertices.push({ p, faces: new Set(), locked: false, seam: false, sharpNeighbors: new Set(), version: 0, signature: null }); }
    const v = vertices[id];
    const signature = uv ? `${base[i * 2]},${base[i * 2 + 1]}` : '';
    if (v.signature !== null && v.signature !== signature) v.seam = true;
    v.signature = signature;
    if (i % 3 === 0) faces.push({ ids: [], corners: [], active: true });
    faces.at(-1).ids.push(id); faces.at(-1).corners.push(i);
    v.faces.add(faces.length - 1);
  }
  const cross = (a, b, c) => {
    const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
    const u = c[0] - a[0], v = c[1] - a[1], w = c[2] - a[2];
    return [y * w - z * v, z * u - x * w, x * v - y * u];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const faceNormal = ids => cross(...ids.map(i => vertices[i].p));
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const edges = new Map();
  faces.forEach((f, fi) => { f.n = faceNormal(f.ids); for (let j = 0; j < 3; j++) { const k = edgeKey(f.ids[j], f.ids[(j + 1) % 3]); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(fi); } });
  const constrainedEdges = new Set();
  for (const [key, incident] of edges) {
    const [a, b] = key.split(':').map(Number);
    if (incident.length !== 2) { vertices[a].locked = vertices[b].locked = true; continue; }
    const n = faces[incident[0]].n, m = faces[incident[1]].n;
    const sharp = dot(n, m) < Math.sqrt(dot(n, n) * dot(m, m)) * Math.cos(Math.PI / 6);
    const seam = [a, b].some(id => {
      const corners = incident.map(fi => faces[fi].corners[faces[fi].ids.indexOf(id)]);
      return uv && (base[corners[0] * 2] !== base[corners[1] * 2] || base[corners[0] * 2 + 1] !== base[corners[1] * 2 + 1]);
    });
    if (sharp || seam) constrainedEdges.add(key);
    if (sharp) { vertices[a].sharpNeighbors.add(b); vertices[b].sharpNeighbors.add(a); }

  }
  for (const v of vertices) if (v.sharpNeighbors.size) {
    if (v.sharpNeighbors.size !== 2) { v.locked = true; continue; }
    const directions = [...v.sharpNeighbors].map(id => vertices[id].p.map((x, j) => x - v.p[j]));
    const [a, b] = directions;
    if (dot(a, b) > -Math.sqrt(dot(a, a) * dot(b, b)) * Math.cos(Math.PI / 9)) v.locked = true;
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], v.p[j]); max[j] = Math.max(max[j], v.p[j]); }
  for (let j = 0; j < 3; j++) {
    // One fixed representative per extremum keeps bounds and the object pivot.
    vertices.find(v => v.p[j] === min[j]).locked = true;
    vertices.find(v => v.p[j] === max[j]).locked = true;
  }
  const diagonal = Math.hypot(...max.map((x, i) => x - min[i]));
  // Endpoints never move. The error bound limits the distance of a removed
  // vertex to the surviving local surface, rather than collapsing long fans.
  const error = diagonal * (0.00002 + amount / 90 * 0.002);
  const heap = [];
  const push = item => { let i = heap.length; heap.push(item); while (i) { const parent = (i - 1) >> 1; if (heap[parent].cost <= item.cost) break; heap[i] = heap[parent]; i = parent; } heap[i] = item; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++; if (heap[child].cost >= last.cost) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return top; };
  const offer = (a, b) => {
    if (a === b || (vertices[a].locked || vertices[b].locked)) return;
    if (vertices[a].seam !== vertices[b].seam || !!vertices[a].sharpNeighbors.size !== !!vertices[b].sharpNeighbors.size) return;
    if ((vertices[a].seam || vertices[a].sharpNeighbors.size) && !constrainedEdges.has(edgeKey(a, b))) return;
    push({ a, b, va: vertices[a].version, vb: vertices[b].version, cost: vertices[a].p.reduce((s, x, i) => s + (x - vertices[b].p[i]) ** 2, 0) });
  };
  for (const key of edges.keys()) offer(...key.split(':').map(Number));
  let remaining = faces.length, attempts = 0;
  const target = Math.max(4, Math.ceil(remaining * (1 - amount / 100)));
  const budget = Math.min(300000, Math.max(10000, faces.length * 30));
  while (heap.length && remaining > target && attempts++ < budget) {
    const item = pop(), { a, b } = item, va = vertices[a], vb = vertices[b];
    if (va.version !== item.va || vb.version !== item.vb || va.locked || vb.locked || !va.faces.size || !vb.faces.size) continue;
    const commonFaces = [...va.faces].filter(fi => vb.faces.has(fi));
    if (commonFaces.length !== 2 || remaining - 2 < 4) continue;
    const neighbors = v => new Set([...v.faces].flatMap(fi => faces[fi].ids).filter(id => id !== a && id !== b));
    const na = neighbors(va), nb = neighbors(vb), opposite = commonFaces.map(fi => faces[fi].ids.find(id => id !== a && id !== b));
    const common = [...na].filter(id => nb.has(id));
    if (common.length !== 2 || !common.every(id => opposite.includes(id))) continue;
    const affected = [...va.faces].filter(fi => !commonFaces.includes(fi));
    let valid = true;
    for (const fi of affected) {
      const f = faces[fi], n = faceNormal(f.ids.map(id => id === a ? b : id));
      const oldLength = Math.sqrt(dot(f.n, f.n)), length = Math.sqrt(dot(n, n));
      if (!length || dot(f.n, n) < oldLength * length * 0.98 || Math.abs(dot(f.n, vb.p.map((x, j) => x - va.p[j]))) > error * oldLength) { valid = false; break; }
    }
    if (!valid) continue;
    // Prevent removing the last triangles of a tiny closed component.
    if (new Set([...va.faces, ...vb.faces]).size <= 4) continue;
    const targetFaces = [...vb.faces].map(fi => faces[fi]);
    const targetCornerFor = face => {
      let best = -Infinity, bestUV = Infinity, corner = 0;
      const removedCorner = face.corners[face.ids.indexOf(a)];
      for (const f of targetFaces) {
        const score = dot(face.n, f.n) / (Math.sqrt(dot(f.n, f.n)) || 1);
        const candidate = f.corners[f.ids.indexOf(b)];
        const uvDistance = uv ? (base[candidate * 2] - base[removedCorner * 2]) ** 2 + (base[candidate * 2 + 1] - base[removedCorner * 2 + 1]) ** 2 : 0;
        const tolerance = Math.sqrt(dot(face.n, face.n)) * 1e-6;
        if (score > best + tolerance || Math.abs(score - best) <= tolerance && uvDistance < bestUV) { best = score; bestUV = uvDistance; corner = candidate; }
      }
      return corner;
    };
    for (const fi of commonFaces) {
      const f = faces[fi]; f.active = false;
      for (const id of f.ids) vertices[id].faces.delete(fi);
      remaining--;
    }
    for (const fi of affected) {
      const f = faces[fi], j = f.ids.indexOf(a), targetCorner = targetCornerFor(f); f.ids[j] = b; f.corners[j] = targetCorner; f.n = faceNormal(f.ids); vb.faces.add(fi);
    }
    va.faces.clear(); va.version++; vb.version++;
    for (const fi of vb.faces) for (const id of faces[fi].ids) if (id !== b) offer(id, b);
  }
  const output = new BufferGeometry(), outP = [], outUV = [], outN = [], outBase = [], keys = [];
  for (const f of faces) if (f.active) for (let j = 0; j < 3; j++) {
    const id = f.ids[j], corner = f.corners[j]; outP.push(...vertices[id].p);
    if (uv) { outUV.push(uv.getX(corner), uv.getY(corner)); outBase.push(base[corner * 2], base[corner * 2 + 1]); }
    if (normal) outN.push(normal.getX(corner), normal.getY(corner), normal.getZ(corner));
    keys.push(source.userData.uvKeys?.[corner] ?? `mesh-${corner}`);
  }
  output.setAttribute('position', new Float32BufferAttribute(outP, 3));
  if (uv) output.setAttribute('uv', new Float32BufferAttribute(outUV, 2));
  if (normal) output.setAttribute('normal', new Float32BufferAttribute(outN, 3)); else output.computeVertexNormals();
  output.userData = { ...geometry.userData, warnings: [...(geometry.userData.warnings ?? [])], baseUVs: new Float64Array(outBase), uvKeys: keys, meshOriginalTriangles: faces.length, meshReducedTriangles: remaining };
  if (remaining > target) output.userData.warnings.push('穴・尖った角・UV の境界を保護するため、メッシュの削減率を安全な範囲に制限しました。');
  output.computeBoundingBox(); output.computeBoundingSphere();
  if (source !== geometry) source.dispose();
  return output;
}
