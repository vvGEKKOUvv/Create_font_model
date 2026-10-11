import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

const EPS = 1e-7;
export function parseSvg(text) {
  if (typeof text !== "string" || !/<svg[\s>]/i.test(text))
    throw new Error("SVG ファイルを読み込んでください。");
  if (text.length > 5_000_000)
    throw new Error(
      "SVG が大きすぎます。5 MB 以下のファイルを使用してください。",
    );
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text))
    throw new Error("DOCTYPE / ENTITY を含む SVG は読み込めません。");
  // Illustrator often includes an external SVG DTD. Strip the declaration:
  // it is unnecessary for geometry and must never trigger a network request.
  text = text.replace(/<!DOCTYPE\s+[^>]*>/gi, "");
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    document.getElementsByTagName("parsererror").length ||
    document.documentElement?.nodeName?.toLowerCase() !== "svg"
  )
    throw new Error("SVG XML が不正です。ファイルを修正してください。");
  const data = new SVGLoader().parse(text);
  const objects = [],
    warnings = [];
  for (const tag of ["text", "image", "clipPath", "mask", "filter"])
    if (document.getElementsByTagName(tag).length)
      warnings.push(
        `${tag} は 3D 変換に対応していません。必要な要素を通常のパスへ変換してください。`,
      );
  if (data.paths.length > 512)
    throw new Error("パス数が多すぎます（最大 512）。SVG を分割してください。");
  for (const path of data.paths) {
    const style = path.userData?.style || {};
    let hidden = style.display === "none" || style.visibility === "hidden";
    for (
      let node = path.userData?.node;
      node?.getAttribute;
      node = node.parentNode
    ) {
      if (
        node.getAttribute("display") === "none" ||
        node.getAttribute("visibility") === "hidden" ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
          node.getAttribute("style") || "",
        )
      )
        hidden = true;
    }
    if (hidden) continue;
    if (style.fill === "none") {
      warnings.push(
        "塗りのないパスは対象外です。Illustrator で線をアウトライン化してください。",
      );
      continue;
    }
    if (
      path.subPaths.some(
        (p) => !p.autoClose && p.getPoint(0).distanceTo(p.getPoint(1)) > EPS,
      )
    )
      warnings.push(
        "閉じていない塗りパスを直線で閉じて変換しました。必要に応じて SVG 側で閉じてください。",
      );
    for (const shape of SVGLoader.createShapes(path)) {
      if (objects.length >= 256)
        throw new Error(
          "オブジェクト数が多すぎます（最大 256）。SVG を分割してください。",
        );
      const id = `path-${objects.length + 1}`;
      objects.push({
        id,
        name: path.userData?.node?.getAttribute("id") || id,
        shape,
        color: `#${path.color.getHexString()}`,
      });
    }
  }
  if (!objects.length)
    throw new Error(
      "押し出せる塗りパスがありません。線はアウトライン化してください。",
    );
  return { objects, warnings: [...new Set(warnings)] };
}

function area(points) {
  return THREE.ShapeUtils.area(points);
}
function clean(points, ccw) {
  const result = points
    .filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > EPS)
    .map((p) => p.clone());
  if (result.length > 1 && result[0].distanceTo(result.at(-1)) < EPS)
    result.pop();
  if (result.length < 3 || Math.abs(area(result)) < EPS)
    throw new Error(
      "輪郭が退化しています。閉じた面積のあるパスを使用してください。",
    );
  if (area(result) > 0 !== ccw) result.reverse();
  return result;
}
function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}
function offset(points, distance, sharp = true) {
  return points.map((p, i) => {
    const a = p
      .clone()
      .sub(points[(i + points.length - 1) % points.length])
      .normalize();
    const b = points[(i + 1) % points.length].clone().sub(p).normalize();
    const n1 = new THREE.Vector2(-a.y, a.x),
      n2 = new THREE.Vector2(-b.y, b.x);
    const sum = n1.add(n2),
      denom = sum.dot(n2);
    if (Math.abs(denom) < EPS) return p.clone();
    const move = sum.multiplyScalar(distance / denom);
    const limit = Math.abs(distance) * (sharp ? 10 : 1.5);
    if (move.length() > limit) move.setLength(limit);
    return p.clone().add(move);
  });
}
function intersects(a, b, c, d) {
  const ab = b.clone().sub(a),
    cd = d.clone().sub(c);
  const divisor = cross(ab, cd);
  if (Math.abs(divisor) < EPS) {
    if (Math.abs(cross(c.clone().sub(a), ab)) > EPS) return false;
    const length = ab.lengthSq();
    if (length < EPS * EPS) return true;
    const t0 = c.clone().sub(a).dot(ab) / length,
      t1 = d.clone().sub(a).dot(ab) / length;
    return Math.max(Math.min(t0, t1), 0) < Math.min(Math.max(t0, t1), 1) - EPS;
  }
  const ac = c.clone().sub(a);
  const t = cross(ac, cd) / divisor,
    u = cross(ac, ab) / divisor;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
}
function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i],
      edge = b.clone().sub(a),
      delta = point.clone().sub(a);
    if (
      Math.abs(cross(edge, delta)) < EPS &&
      delta.dot(edge) >= -EPS &&
      delta.dot(edge) <= edge.lengthSq() + EPS
    )
      return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
function validRings(rings) {
  for (let r = 0; r < rings.length; r++) {
    const p = rings[r];
    if (area(p) > 0 !== (r === 0) || Math.abs(area(p)) < EPS) return false;
    if (r > 0 && !p.every((v) => inside(v, rings[0]))) return false;
    for (let s = 1; s < r; s++)
      if (inside(p[0], rings[s]) || inside(rings[s][0], p)) return false;
    if (p.some((v, i) => v.distanceTo(p[(i + 1) % p.length]) < EPS))
      return false;
    for (let i = 0; i < p.length; i++)
      for (let s = r; s < rings.length; s++) {
        const q = rings[s];
        for (let j = s === r ? i + 2 : 0; j < q.length; j++) {
          if (s === r && i === 0 && j === q.length - 1) continue;
          if (
            intersects(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length])
          )
            return false;
        }
      }
  }
  return true;
}

export function buildMesh(shape, settings = {}) {
  const uvEdits = settings.uvEdits ?? {};
  if (typeof uvEdits !== "object" || Array.isArray(uvEdits))
    throw new Error("UV 編集データの形式が不正です。");
  for (const coordinates of Object.values(uvEdits)) {
    if (
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      !coordinates.every(Number.isFinite)
    )
      throw new Error("UV 編集座標には有限の数値を指定してください。");
  }
  for (const field of [
    "depth",
    "bevelSize",
    "bevelSegments",
    "curve",
    "wallThickness",
    "uvScale",
    "uvScaleX",
    "uvScaleY",
    "uvOffsetX",
    "uvOffsetY",
    "uvRotation",
  ]) {
    if (
      settings[field] !== undefined &&
      !Number.isFinite(Number(settings[field]))
    )
      throw new Error(`${field} に有限の数値を指定してください。`);
  }
  const depth = Math.max(0.01, Number(settings.depth) || 20);
  const extracted = shape.extractPoints(24);
  let rings = [
    clean(extracted.shape, true),
    ...extracted.holes.map((p) => clean(p, false)),
  ];
  const warnings = [];
  if (rings.reduce((n, p) => n + p.length, 0) > 3000)
    throw new Error(
      "輪郭が複雑すぎます。SVG のパスを簡略化してください（最大 3000 頂点）。",
    );
  if (!validRings(rings))
    throw new Error("パスが自己交差しています。SVG の輪郭を修正してください。");
  const sharp = settings.sharpCorners !== false;
  if (settings.hollow) {
    if (rings.length > 1)
      warnings.push("既存の穴を優先し、自動中抜きは追加していません。");
    else {
      const wall = Math.max(0.01, Number(settings.wallThickness) || 3);
      const inner = offset(rings[0], wall, true);
      const edgesForward = inner.every(
        (v, i) =>
          inner[(i + 1) % inner.length]
            .clone()
            .sub(v)
            .dot(rings[0][(i + 1) % inner.length].clone().sub(rings[0][i])) >
          EPS,
      );
      if (
        !validRings([inner]) ||
        !edgesForward ||
        !inner.every((v) => inside(v, rings[0])) ||
        Math.abs(area(inner)) >= Math.abs(area(rings[0]))
      )
        throw new Error(
          "壁厚が輪郭に対して大きすぎます。壁厚を小さくしてください。",
        );
      const candidate = [rings[0], inner.reverse()];
      if (!validRings(candidate))
        throw new Error("中抜きが自己交差します。壁厚を小さくしてください。");
      rings = candidate;
    }
  }
  let bevel = Math.max(0, Math.min(Number(settings.bevelSize) || 0, depth / 2));
  const originalBevel = Math.max(0, Number(settings.bevelSize) || 0);
  const box = new THREE.Box2().setFromPoints(rings.flat());
  bevel = Math.min(
    bevel,
    Math.min(box.max.x - box.min.x, box.max.y - box.min.y) / 4,
  );
  let safeBevel = bevel === 0;
  for (let attempt = 0; bevel > EPS && attempt < 14; attempt++) {
    const shifted = rings.map((p) => offset(p, bevel, sharp));
    const nested =
      shifted[0].every((p) => inside(p, rings[0])) &&
      rings.slice(1).every((p, i) => p.every((v) => inside(v, shifted[i + 1])));
    const edgesPreserved = shifted.every((p, r) =>
      p.every(
        (v, i) =>
          p[(i + 1) % p.length]
            .clone()
            .sub(v)
            .dot(rings[r][(i + 1) % p.length].clone().sub(rings[r][i])) > EPS,
      ),
    );
    if (
      validRings(shifted) &&
      nested &&
      edgesPreserved &&
      Math.abs(area(shifted[0])) < Math.abs(area(rings[0]))
    ) {
      safeBevel = true;
      break;
    }
    bevel *= 0.5;
  }
  if (bevel < EPS || !safeBevel) bevel = 0;
  if (bevel + EPS < originalBevel)
    warnings.push(
      "深さ・細い輪郭・交差を考慮し、ベベル幅を安全側に縮小しました。",
    );
  const segments = Math.max(
    1,
    Math.min(32, Math.floor(Number(settings.bevelSegments) || 8)),
  );
  const curve = THREE.MathUtils.clamp(Number(settings.curve) || 0, 0, 1);
  const points = Array.isArray(settings.curvePoints)
    ? settings.curvePoints
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x)
    : [];
  const usePoints =
    points.length >= 2 &&
    Math.abs(points[0].x) < EPS &&
    Math.abs(points[0].y) < EPS &&
    Math.abs(points.at(-1).x - 1) < EPS &&
    Math.abs(points.at(-1).y - 1) < EPS &&
    points.every(
      (p, i) =>
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1 &&
        (!i || (p.x > points[i - 1].x && p.y >= points[i - 1].y)),
    );
  if (points.length && !usePoints)
    warnings.push(
      "ベベルカーブは両端 (0,0)・(1,1) と単調増加の制御点が必要です。標準カーブを使用しました。",
    );
  const profile = (t) => {
    if (!usePoints)
      return (1 - curve) * t + curve * (1 - Math.cos((t * Math.PI) / 2));
    const i = Math.max(
      1,
      points.findIndex((p) => p.x >= t),
    );
    const a = points[i - 1],
      b = points[i];
    return a.y + ((b.y - a.y) * (t - a.x)) / (b.x - a.x);
  };
  const levels = bevel
    ? Array.from({ length: segments + 1 }, (_, i) => ({
        z: (bevel * i) / segments,
        inset: bevel * (1 - profile(i / segments)),
      }))
    : [{ z: 0, inset: 0 }];
  if (depth - bevel - levels.at(-1).z > EPS)
    levels.push({ z: depth - bevel, inset: 0 });
  if (bevel)
    for (let i = segments - 1; i >= 0; i--)
      levels.push({
        z: depth - (bevel * i) / segments,
        inset: bevel * (1 - profile(i / segments)),
      });
  const positions = [],
    uvs = [],
    surfaceGroups = [];
  let surfaceGroup = 0;
  const scale = Math.max(0.0001, Number(settings.uvScale) || 1);
  const scaleX = Number.isFinite(Number(settings.uvScaleX))
    ? Math.max(0.0001, Number(settings.uvScaleX))
    : scale;
  const scaleY = Number.isFinite(Number(settings.uvScaleY))
    ? Math.max(0.0001, Number(settings.uvScaleY))
    : scale;
  const angle = ((Number(settings.uvRotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const uvKeys = [];
  const add = (p, uv) => {
    positions.push(p.x, -p.y, p.z);
    surfaceGroups.push(surfaceGroup);
    const key = `${uv.x.toFixed(6)},${uv.y.toFixed(6)}`;
    uvKeys.push(key);
    const edited = Object.hasOwn(uvEdits, key) ? uvEdits[key] : null;
    const u = edited ? edited[0] : uv.x;
    const v = edited ? edited[1] : uv.y;
    uvs.push(
      (u * cos - v * sin) * scaleX + (Number(settings.uvOffsetX) || 0),
      (u * sin + v * cos) * scaleY + (Number(settings.uvOffsetY) || 0),
    );
  };
  const triangle = (a, b, c, ua, ub, uc) => {
    add(a, ua);
    add(c, uc);
    add(b, ub);
  };
  const width = Math.max(EPS, box.max.x - box.min.x),
    height = Math.max(EPS, box.max.y - box.min.y);
  for (const level of [levels[0], levels.at(-1)]) {
    surfaceGroup = level === levels[0] ? 0 : 1;
    const contour = rings.map((p) => offset(p, level.inset, sharp));
    const flat = contour.flat();
    for (const indices of THREE.ShapeUtils.triangulateShape(
      contour[0],
      contour.slice(1),
    )) {
      const order = level === levels[0] ? [...indices].reverse() : indices;
      const p = order.map(
        (i) => new THREE.Vector3(flat[i].x, flat[i].y, level.z),
      );
      const capSlot = level === levels[0] ? 0 : 1;
      const uv = order.map(
        (i) =>
          new THREE.Vector2(
            (capSlot + 0.02 + (0.96 * (flat[i].x - box.min.x)) / width) / 3,
            0.02 + (0.96 * (flat[i].y - box.min.y)) / height,
          ),
      );
      triangle(...p, ...uv);
    }
  }
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    surfaceGroup = ringIndex + 2;
    const ring = rings[ringIndex];
    const distances = [0];
    for (let i = 0; i < ring.length; i++)
      distances.push(
        distances.at(-1) + ring[i].distanceTo(ring[(i + 1) % ring.length]),
      );
    const total = distances.at(-1);
    const layered = levels.map((l) =>
      offset(ring, l.inset, sharp).map((p) => new THREE.Vector3(p.x, p.y, l.z)),
    );
    for (let l = 0; l < levels.length - 1; l++)
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length,
          u = distances[i] / total,
          v = distances[i + 1] / total;
        const a = layered[l][i],
          b = layered[l][j],
          c = layered[l + 1][j],
          d = layered[l + 1][i];
        const sideUv = (s, z) =>
          new THREE.Vector2(
            (2.02 + s * 0.96) / 3,
            (ringIndex + 0.02 + (0.96 * z) / depth) / rings.length,
          );
        const ua = sideUv(u, levels[l].z),
          ub = sideUv(v, levels[l].z),
          uc = sideUv(v, levels[l + 1].z),
          ud = sideUv(u, levels[l + 1].z);
        triangle(a, b, c, ua, ub, uc);
        triangle(a, c, d, ua, uc, ud);
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Share normals only within a side surface and across gentle turns. Caps and
  // sharp corners keep their own normals, while sampled curves remain smooth.
  const normals = geometry.getAttribute("normal");
  const originalNormals = Float32Array.from(normals.array);
  const groups = new Map();
  for (let i = 0; i < surfaceGroups.length; i++) {
    if (surfaceGroups[i] < 2) continue;
    const key = `${surfaceGroups[i]}:${positions
      .slice(i * 3, i * 3 + 3)
      .map((v) => Math.round(v * 1e6))
      .join(",")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const threshold = Math.cos(Math.PI / 6);
  for (const indices of groups.values())
    for (const i of indices) {
      const reference = new THREE.Vector3().fromArray(originalNormals, i * 3),
        sum = new THREE.Vector3();
      for (const j of indices) {
        const candidate = new THREE.Vector3().fromArray(originalNormals, j * 3);
        if (reference.dot(candidate) >= threshold) sum.add(candidate);
      }
      sum.normalize();
      normals.setXYZ(i, sum.x, sum.y, sum.z);
    }
  geometry.userData = { warnings, effectiveBevel: bevel, uvKeys };
  return geometry;
}

export function exportObj(items) {
  const obj = ["# Path Studio OBJ", "mtllib model.mtl"],
    mtl = ["# Path Studio materials"];
  let base = 1;
  items.forEach((item, index) => {
    const geometry = item.geometry.index
      ? item.geometry.toNonIndexed()
      : item.geometry;
    const p = geometry.getAttribute("position"),
      uv = geometry.getAttribute("uv"),
      n = geometry.getAttribute("normal");
    const name = String(item.name || `object_${index + 1}`).replace(
      /[^a-zA-Z0-9_\-]/g,
      "_",
    );
    const material = `material_${index + 1}`,
      color = new THREE.Color(item.color || "#ffffff");
    obj.push(`o ${name}`, `usemtl ${material}`);
    for (let i = 0; i < p.count; i++)
      obj.push(`v ${p.getX(i)} ${p.getY(i)} ${p.getZ(i)}`);
    for (let i = 0; i < p.count; i++)
      obj.push(`vt ${uv?.getX(i) || 0} ${uv?.getY(i) || 0}`);
    for (let i = 0; i < p.count; i++)
      obj.push(`vn ${n?.getX(i) ?? 0} ${n?.getY(i) ?? 0} ${n?.getZ(i) ?? 1}`);
    for (let i = 0; i < p.count; i += 3)
      obj.push(
        `f ${[base + i, base + i + 1, base + i + 2].map((v) => `${v}/${v}/${v}`).join(" ")}`,
      );
    mtl.push(
      `newmtl ${material}`,
      `Kd ${color.r} ${color.g} ${color.b}`,
      "Ka 0 0 0",
      "Ks 0.15 0.15 0.15",
      "Ns 30",
      "d 1",
      "",
    );
    base += p.count;
    if (geometry !== item.geometry) geometry.dispose();
  });
  return { obj: obj.join("\n") + "\n", mtl: mtl.join("\n") + "\n" };
}
