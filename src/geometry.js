import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

import { prepareContours } from "./path-reduction.js";

import { normalizeProfile, evaluateProfile } from "./bevel-profile.js";
import { prepareBevelRoof, triangulateBevelRoof } from "./bevel-roof.js";
import { hollowContours } from "./hollow-offset.js";
import {
  prepareOffsetBevelRoof,
  triangulateOffsetBevelRoof,
} from "./offset-bevel-roof.js";

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
function offset(points, distance, sharp = true) {
  if (!distance) return points;
  return points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const al = Math.hypot(p.x - prev.x, p.y - prev.y);
    const bl = Math.hypot(next.x - p.x, next.y - p.y);
    const ax = (p.x - prev.x) / al,
      ay = (p.y - prev.y) / al;
    const bx = (next.x - p.x) / bl,
      by = (next.y - p.y) / bl;
    const sx = -ay - by,
      sy = ax + bx;
    const denom = sx * -by + sy * bx;
    if (Math.abs(denom) < 1e-12) return p.clone();
    let mx = (sx * distance) / denom,
      my = (sy * distance) / denom;
    const length = Math.hypot(mx, my),
      limit = Math.abs(distance) * (sharp ? 10 : 1.5);
    if (length > limit) {
      mx *= limit / length;
      my *= limit / length;
    }
    return new THREE.Vector2(p.x + mx, p.y + my);
  });
}
function intersects(a, b, c, d) {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS
  )
    return false;
  const ax = b.x - a.x,
    ay = b.y - a.y,
    bx = d.x - c.x,
    by = d.y - c.y;
  const dx = c.x - a.x,
    dy = c.y - a.y,
    divisor = ax * by - ay * bx;
  if (
    Math.abs(divisor) <
    1e-12 * Math.max(1, Math.hypot(ax, ay) * Math.hypot(bx, by))
  ) {
    if (Math.abs(dx * ay - dy * ax) > EPS * Math.max(1, Math.hypot(ax, ay)))
      return false;
    const length = ax * ax + ay * ay;
    if (length < EPS * EPS) return true;
    const t0 = (dx * ax + dy * ay) / length,
      t1 = ((d.x - a.x) * ax + (d.y - a.y) * ay) / length;
    return (
      Math.max(Math.min(t0, t1), 0) < Math.min(Math.max(t0, t1), 1) - 1e-10
    );
  }
  const t = (dx * by - dy * bx) / divisor,
    u = (dx * ay - dy * ax) / divisor;
  return t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10;
}
function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i],
      ex = b.x - a.x,
      ey = b.y - a.y;
    const dx = point.x - a.x,
      dy = point.y - a.y,
      dot = dx * ex + dy * ey;
    if (
      Math.abs(ex * dy - ey * dx) < EPS * Math.max(1, Math.hypot(ex, ey)) &&
      dot >= -EPS &&
      dot <= ex * ex + ey * ey + EPS
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
function edgesForward(shifted, original) {
  return shifted.every((p, i) => {
    const q = shifted[(i + 1) % shifted.length],
      a = original[i],
      b = original[(i + 1) % original.length];
    return (q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y) > 0;
  });
}
const preparedCache = new WeakMap();
function preparedShape(shape, tolerance) {
  let cache = preparedCache.get(shape);
  if (!cache) {
    cache = new Map();
    preparedCache.set(shape, cache);
  }
  if (cache.has(tolerance)) return cache.get(tolerance);
  const data = prepareContours(shape, tolerance);
  if (data.rings.reduce((n, p) => n + p.length, 0) > 3000)
    throw new Error(
      "輪郭が複雑すぎます。リダクション量を増やしてください（最大 3000 頂点）。",
    );
  if (!validRings(data.rings))
    throw new Error("パスが自己交差しています。SVG の輪郭を修正してください。");
  const result = { ...data, variants: new Map() };
  if (cache.size >= 12) cache.delete(cache.keys().next().value);
  cache.set(tolerance, result);
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
    "reductionTolerance",
    "depth",
    "bevelSize",
    "bevelWidth",
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
  const prepared = preparedShape(
    shape,
    Math.max(0, Number(settings.reductionTolerance) || 0),
  );
  let rings = prepared.rings;
  const warnings = [...prepared.warnings];
  const sharp = settings.sharpCorners !== false;
  const requestedWall = Math.max(0.000001, Number(settings.wallThickness) || 3);
  const explicitWidth = settings.bevelWidth !== undefined;
  const requestedBevelWidth = explicitWidth
    ? Math.max(0, Number(settings.bevelWidth))
    : 0;
  const fullWidth = settings.bevelFullWidth === true || explicitWidth;
  const variantKey = fullWidth
    ? `full:${!!settings.hollow}:${requestedWall}:${sharp}`
    : `${!!settings.hollow}:${requestedWall}:${sharp}:${Math.max(0, Number(settings.bevelSize) || 0)}:${Math.min(depth, 2 * Math.max(0, Number(settings.bevelSize) || 0))}`;
  let variant = prepared.variants.get(variantKey);
  if (!variant) {
    let effectiveWallThickness = 0;
    const localWarnings = [];
    if (settings.hollow) {
      if (rings.length > 1)
        localWarnings.push("既存の穴を優先し、自動中抜きは追加していません。");
      else {
        const outerBox = new THREE.Box2().setFromPoints(rings[0]);
        // Start inside the contour's scale. A fixed number of halvings from
        // the requested value can never find a cavity for very small imports
        // or an oversized numeric input, and previously returned a solid mesh.
        let wall = Math.min(
          requestedWall,
          Math.min(
            outerBox.max.x - outerBox.min.x,
            outerBox.max.y - outerBox.min.y,
          ) / 2,
        );
        let inner = hollowContours(rings[0], wall);
        // Only reduce an actually oversized wall whose cavities disappear.
        // Topology changes inside a surviving cavity do not reduce thickness.
        for (let attempt = 0; !inner.length && attempt < 32; attempt++) {
          wall *= 0.5;
          inner = hollowContours(rings[0], wall);
        }
        const candidate = inner.length ? [rings[0], ...inner] : null;
        if (candidate && validRings(candidate)) {
          rings = candidate;
          effectiveWallThickness = wall;
          if (wall < requestedWall)
            localWarnings.push(
              `指定の壁厚では穴が消えるため、壁厚を ${wall.toPrecision(3)} に縮小しました。`,
            );
        } else
          throw new Error(
            "内側の穴を保持できないため、中抜きの生成を中止しました。壁厚を小さくしてください。",
          );
      }
    }
    const originalBevel = Math.max(0, Number(settings.bevelSize) || 0);
    const box = new THREE.Box2().setFromPoints(rings.flat());
    const checkInset = (distance) => {
      const shifted = rings.map((p) => offset(p, distance, sharp));
      return (
        shifted.every((p, r) => edgesForward(p, rings[r])) &&
        shifted[0].every((p) => inside(p, rings[0])) &&
        rings
          .slice(1)
          .every((p, i) => p.every((v) => inside(v, shifted[i + 1]))) &&
        validRings(shifted) &&
        Math.abs(area(shifted[0])) < Math.abs(area(rings[0]))
      );
    };
    let maximumBevelWidth = 0;
    let bevel = Math.min(
      originalBevel,
      depth / 2,
      Math.min(box.max.x - box.min.x, box.max.y - box.min.y) / 4,
    );
    if (fullWidth) {
      // Cache a contour-dependent limit, independent of the depth slider. A
      // binary refinement approaches the ridge instead of leaving the wide
      // flat cap produced by halving the requested width after a collision.
      let high = Math.min(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
      let low = high;
      let safe = high > EPS && checkInset(high);
      for (let attempt = 0; !safe && low > EPS && attempt < 24; attempt++) {
        high = low;
        low *= 0.5;
        safe = checkInset(low);
      }
      if (safe) {
        for (let attempt = 0; attempt < 18; attempt++) {
          const middle = (low + high) / 2;
          if (checkInset(middle)) low = middle;
          else high = middle;
        }
        // Do not collapse to an exact line: keep caps and triangles manifold.
        const coordinateScale = Math.max(
          1,
          Math.abs(box.min.x),
          Math.abs(box.min.y),
          Math.abs(box.max.x),
          Math.abs(box.max.y),
        );
        const residual = Math.max(low * 0.0001, coordinateScale * 2 ** -23 * 2);
        maximumBevelWidth = Math.max(0, low - residual);
      } else
        localWarnings.push(
          "輪郭の交差を避けられないため、ベベルを無効にしました。",
        );
      bevel = maximumBevelWidth;
    } else {
      let safeBevel = bevel === 0;
      for (let attempt = 0; bevel > EPS && attempt < 24; attempt++) {
        if (checkInset(bevel)) {
          safeBevel = true;
          break;
        }
        bevel *= 0.5;
      }
      if (bevel < EPS || !safeBevel) bevel = 0;
      if (originalBevel > depth / 2 + EPS)
        localWarnings.push("ベベルの奥行きを押し出しの半分に制限しました。");
      if (bevel + EPS < Math.min(originalBevel, depth / 2))
        localWarnings.push(
          bevel > 0
            ? "細い輪郭・交差を考慮し、ベベル幅を安全側に縮小しました。ベベルの奥行きは保持しています。"
            : "輪郭の交差を避けられないため、ベベルを無効にしました。",
        );
    }
    variant = {
      rings,
      box,
      bevel,
      effectiveWallThickness,
      maximumBevelWidth,
      warnings: localWarnings,
    };
    if (prepared.variants.size >= 24)
      prepared.variants.delete(prepared.variants.keys().next().value);
    prepared.variants.set(variantKey, variant);
  }
  rings = variant.rings;
  const { box, effectiveWallThickness } = variant;
  let roof = null;
  let roofFailure = null;
  if (
    settings.bevelContinue === true &&
    Number(settings.bevelSize) > 0 &&
    rings.length === 1
  ) {
    try {
      roof = prepareBevelRoof(rings);
    } catch (error) {
      roofFailure = error;
    }
  }
  // Preserve the original boundary while allowing tiny tips to disappear
  // locally inside the bevel instead of restricting the entire contour.
  if (
    Number(settings.bevelSize) > 0 &&
    ((!roof &&
      ((explicitWidth &&
        requestedBevelWidth > variant.maximumBevelWidth + EPS) ||
        settings.bevelContinue === true)) ||
      (roof && explicitWidth && requestedBevelWidth > roof.maximumWidth + EPS))
  ) {
    const offsetRoof = prepareOffsetBevelRoof(
      rings,
      effectiveWallThickness > 0 ? effectiveWallThickness / 2 : undefined,
    );
    if (
      settings.bevelContinue === true ||
      !roof ||
      offsetRoof.maximumWidth > roof.maximumWidth + EPS
    )
      roof = offsetRoof;
  }
  if (roofFailure)
    warnings.push(
      roof?.offsetRoof
        ? "安定した輪郭差分方式でベベルを生成しました。"
        : `${roofFailure.message} 通常ベベルを使用しました。`,
    );
  const bevel = roof
    ? explicitWidth
      ? Math.min(requestedBevelWidth, roof.maximumWidth)
      : roof.maximumWidth *
        THREE.MathUtils.clamp(
          Math.max(0, Number(settings.bevelSize) || 0) / (depth / 2),
          0,
          1,
        )
    : explicitWidth
      ? Math.min(requestedBevelWidth, variant.maximumBevelWidth)
      : fullWidth
        ? variant.maximumBevelWidth *
          THREE.MathUtils.clamp(
            Math.max(0, Number(settings.bevelSize) || 0) / (depth / 2),
            0,
            1,
          )
        : variant.bevel;
  // Inset safety restricts the lateral width, independently of axial reach.
  let bevelHeight =
    bevel > 0
      ? Math.min(Math.max(0, Number(settings.bevelSize) || 0), depth / 2)
      : 0;
  // Opposing inner/outer bevels must retain a substantial straight wall.
  // Constrain their actual axial reach even when the requested lateral width
  // already fits: shrinking only an oversized width misses small-width edits
  // and the conventional/fallback bevel path entirely. Solid ridges retain
  // their independently controlled axial reach.
  if (rings.length > 1 && bevelHeight > Math.min(bevel, depth / 4) + EPS) {
    bevelHeight = Math.min(bevel, depth / 4);
    warnings.push(
      "中空の厚みを保つため、奥行方向のベベルを輪郭幅と押し出し厚に合わせて制限しました。",
    );
  }
  warnings.push(
    ...variant.warnings.filter(
      (message) => !roof || !message.includes("ベベル"),
    ),
  );
  if (
    !roof &&
    explicitWidth &&
    requestedBevelWidth > variant.maximumBevelWidth + EPS
  )
    warnings.push(
      "輪郭の交差を防ぐため、ベベル幅を安全な最大幅に制限しました。",
    );
  const segments = Math.max(
    1,
    Math.min(32, Math.floor(Number(settings.bevelSegments) || 8)),
  );
  const curve = THREE.MathUtils.clamp(Number(settings.curve) || 0, 0, 1);
  let points = [];
  if (Array.isArray(settings.curvePoints) && settings.curvePoints.length) {
    if (settings.curvePoints.length > 16)
      throw new Error("ベベルカーブの頂点は両端を含めて最大 16 個です。");
    try {
      points = normalizeProfile(settings.curvePoints);
    } catch (error) {
      warnings.push(`${error.message} 標準カーブを使用しました。`);
    }
  }
  const usePoints = points.length >= 2;
  const profile = (t) =>
    usePoints
      ? evaluateProfile(points, t)
      : (1 - curve) * t + curve * (1 - Math.cos((t * Math.PI) / 2));
  const bezierSamples = [];
  if (usePoints)
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      if (a.mode !== "bezier" && b.mode !== "bezier") continue;
      // Curved segments need intermediate rings even with a low division setting.
      const count = Math.max(2, Math.ceil(Math.max(8, segments) * (b.x - a.x)));
      for (let j = 1; j < count; j++)
        bezierSamples.push(a.x + ((b.x - a.x) * j) / count);
    }
  // Include every control point so a narrow bend survives low segment counts.
  // Share the same samples on both ends, with a single level at depth / 2.
  const samples = [
    ...new Set([
      ...Array.from({ length: segments + 1 }, (_, i) => i / segments),
      ...(usePoints ? points.map((p) => p.x) : []),
      ...bezierSamples,
    ]),
  ].sort((a, b) => a - b);
  const levels = bevel
    ? samples.map((t) => ({
        z: bevelHeight * t,
        inset: bevel * (1 - profile(t)),
      }))
    : [{ z: 0, inset: 0 }];
  if (depth - bevelHeight - levels.at(-1).z > EPS)
    levels.push({ z: depth - bevelHeight, inset: 0 });
  if (bevel)
    for (let i = samples.length - 2; i >= 0; i--)
      levels.push({
        z: depth - bevelHeight * samples[i],
        inset: bevel * (1 - profile(samples[i])),
      });
  const positions = [],
    uvs = [],
    baseUVs = [],
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
    baseUVs.push(uv.x, uv.y);
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
  let roofTriangles = null;
  if (roof && bevel > EPS) {
    try {
      roofTriangles = roof.offsetRoof
        ? triangulateOffsetBevelRoof(roof, bevel, samples, profile)
        : triangulateBevelRoof(roof, bevel, samples, profile);
    } catch (error) {
      throw new Error(error.message);
    }
  }
  if (roofTriangles) {
    for (const back of [false, true]) {
      for (const face of roofTriangles) {
        surfaceGroup = face.points.every((p) => Math.abs(p.height) < EPS)
          ? 2
          : 3;
        const points = face.points.map(
          (p) =>
            new THREE.Vector3(
              p.x,
              p.y,
              back ? depth - bevelHeight * p.height : bevelHeight * p.height,
            ),
        );
        const uv = face.points.map(
          (p) =>
            new THREE.Vector2(
              ((back ? 1 : 0) + 0.02 + (0.96 * (p.x - box.min.x)) / width) / 3,
              0.02 + (0.96 * (p.y - box.min.y)) / height,
            ),
        );
        if (!back) {
          points.reverse();
          uv.reverse();
        }
        triangle(...points, ...uv);
      }
    }
    if (depth - 2 * bevelHeight > EPS) {
      for (let r = 0; r < rings.length; r++) {
        surfaceGroup = r + roof.faces.length + 2;
        for (let i = 0; i < rings[r].length; i++) {
          const a = rings[r][i],
            b = rings[r][(i + 1) % rings[r].length];
          const p = [
            new THREE.Vector3(a.x, a.y, bevelHeight),
            new THREE.Vector3(b.x, b.y, bevelHeight),
            new THREE.Vector3(b.x, b.y, depth - bevelHeight),
            new THREE.Vector3(a.x, a.y, depth - bevelHeight),
          ];
          const uv = [
            new THREE.Vector2(2 / 3, i / rings[r].length),
            new THREE.Vector2(1, i / rings[r].length),
            new THREE.Vector2(1, (i + 1) / rings[r].length),
            new THREE.Vector2(2 / 3, (i + 1) / rings[r].length),
          ];
          triangle(p[0], p[1], p[2], uv[0], uv[1], uv[2]);
          triangle(p[0], p[2], p[3], uv[0], uv[2], uv[3]);
        }
      }
    }
  } else {
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
        offset(ring, l.inset, sharp).map(
          (p) => new THREE.Vector3(p.x, p.y, l.z),
        ),
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
    const j = i * 3;
    const key = `${surfaceGroups[i]}:${Math.round(positions[j] * 1e6)},${Math.round(positions[j + 1] * 1e6)},${Math.round(positions[j + 2] * 1e6)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const threshold = Math.cos(Math.PI / 6);
  // A corner angle weight is invariant when a face is split into skinny
  // triangles. Build shared smoothing components once; filtering separately
  // from each face creates several different normals at one smooth vertex.
  const cornerWeights = new Float64Array(surfaceGroups.length);
  for (let i = 0; i < surfaceGroups.length; i++) {
    const tri = i - (i % 3),
      next = tri + ((i + 1) % 3),
      prev = tri + ((i + 2) % 3);
    const a = new THREE.Vector3(
      positions[next * 3] - positions[i * 3],
      positions[next * 3 + 1] - positions[i * 3 + 1],
      positions[next * 3 + 2] - positions[i * 3 + 2],
    );
    const b = new THREE.Vector3(
      positions[prev * 3] - positions[i * 3],
      positions[prev * 3 + 1] - positions[i * 3 + 1],
      positions[prev * 3 + 2] - positions[i * 3 + 2],
    );
    cornerWeights[i] = a.lengthSq() && b.lengthSq() ? a.angleTo(b) : 0;
  }
  for (const indices of groups.values()) {
    const smoothThreshold =
      roofTriangles && surfaceGroups[indices[0]] === 3
        ? Math.cos(Math.PI / 3)
        : threshold;
    const pending = new Set(indices);
    while (pending.size) {
      const cluster = [pending.values().next().value];
      pending.delete(cluster[0]);
      for (let cursor = 0; cursor < cluster.length; cursor++) {
        const i = cluster[cursor] * 3;
        for (const j of pending) {
          const k = j * 3;
          if (
            originalNormals[i] * originalNormals[k] +
              originalNormals[i + 1] * originalNormals[k + 1] +
              originalNormals[i + 2] * originalNormals[k + 2] >=
            smoothThreshold
          ) {
            cluster.push(j);
            pending.delete(j);
          }
        }
      }
      let sx = 0,
        sy = 0,
        sz = 0;
      for (const i of cluster) {
        const k = i * 3,
          w = cornerWeights[i];
        sx += originalNormals[k] * w;
        sy += originalNormals[k + 1] * w;
        sz += originalNormals[k + 2] * w;
      }
      const length = Math.hypot(sx, sy, sz) || 1;
      for (const i of cluster)
        normals.setXYZ(i, sx / length, sy / length, sz / length);
    }
  }
  geometry.userData = {
    warnings,
    effectiveBevel: bevel,
    maximumBevelWidth: roof ? roof.maximumWidth : variant.maximumBevelWidth,
    continuedBevel: !!roofTriangles,
    effectiveBevelDepth: bevelHeight,
    centralWallDepth: depth - 2 * bevelHeight,
    effectiveWallThickness,
    originalCount: prepared.originalCount,
    reducedCount: prepared.reducedCount,
    uvKeys,
    baseUVs: new Float64Array(baseUVs),
  };
  return geometry;
}

export function applyUvSettings(geometry, settings = {}) {
  const uv = geometry.getAttribute("uv"),
    base = geometry.userData.baseUVs,
    keys = geometry.userData.uvKeys;
  if (!base || base.length !== uv.count * 2)
    throw new Error("UV 元データがありません。");
  const edits = settings.uvEdits ?? {};
  if (typeof edits !== "object" || Array.isArray(edits))
    throw new Error("UV 編集データの形式が不正です。");
  for (const point of Object.values(edits))
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every(Number.isFinite)
    )
      throw new Error("UV 編集座標には有限の数値を指定してください。");
  for (const field of [
    "uvScale",
    "uvScaleX",
    "uvScaleY",
    "uvOffsetX",
    "uvOffsetY",
    "uvRotation",
  ])
    if (
      settings[field] !== undefined &&
      !Number.isFinite(Number(settings[field]))
    )
      throw new Error(`${field} に有限の数値を指定してください。`);
  const scale = Math.max(0.0001, Number(settings.uvScale) || 1),
    sx =
      settings.uvScaleX === undefined
        ? scale
        : Math.max(0.0001, Number(settings.uvScaleX)),
    sy =
      settings.uvScaleY === undefined
        ? scale
        : Math.max(0.0001, Number(settings.uvScaleY));
  const angle = ((Number(settings.uvRotation) || 0) * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  for (let i = 0; i < uv.count; i++) {
    const edited = Object.hasOwn(edits, keys[i]) ? edits[keys[i]] : null;
    const u = edited ? edited[0] : base[i * 2],
      v = edited ? edited[1] : base[i * 2 + 1];
    uv.setXY(
      i,
      (u * c - v * s) * sx + (Number(settings.uvOffsetX) || 0),
      (u * s + v * c) * sy + (Number(settings.uvOffsetY) || 0),
    );
  }
  uv.needsUpdate = true;
}

export function exportObj(items) {
  const obj = ["# Path Studio OBJ", "mtllib model.mtl"],
    mtl = ["# Path Studio materials"];
  let base = 1;
  const names = new Set();
  items.forEach((item, index) => {
    const geometry = item.geometry.index
      ? item.geometry.toNonIndexed()
      : item.geometry;
    const p = geometry.getAttribute("position"),
      uv = geometry.getAttribute("uv"),
      n = geometry.getAttribute("normal");
    const rawName = String(item.name || `object_${index + 1}`).replace(
      /[^\p{L}\p{N}_-]/gu,
      "_",
    );
    let name = rawName,
      suffix = 2;
    while (names.has(name)) name = `${rawName}_${suffix++}`;
    names.add(name);
    const material = `material_${index + 1}`,
      color = new THREE.Color(item.color || "#ffffff");
    const matrix = item.matrix || new THREE.Matrix4();
    if (
      !matrix.elements.every(Number.isFinite) ||
      Math.abs(matrix.determinant()) < 1e-12
    )
      throw new Error(
        "書き出すオブジェクトの変換が不正です。スケールを確認してください。",
      );
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const point = new THREE.Vector3(),
      normal = new THREE.Vector3();
    obj.push(`o ${name}`, `usemtl ${material}`);
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(matrix);
      obj.push(`v ${point.x} ${point.y} ${point.z}`);
    }
    for (let i = 0; i < p.count; i++)
      obj.push(`vt ${uv?.getX(i) || 0} ${uv?.getY(i) || 0}`);
    for (let i = 0; i < p.count; i++) {
      normal
        .set(n?.getX(i) ?? 0, n?.getY(i) ?? 0, n?.getZ(i) ?? 1)
        .applyNormalMatrix(normalMatrix);
      obj.push(`vn ${normal.x} ${normal.y} ${normal.z}`);
    }
    for (let i = 0; i < p.count; i += 3)
      obj.push(
        `f ${(matrix.determinant() < 0 ? [base + i, base + i + 2, base + i + 1] : [base + i, base + i + 1, base + i + 2]).map((v) => `${v}/${v}/${v}`).join(" ")}`,
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
