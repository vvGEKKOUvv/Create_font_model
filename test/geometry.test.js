import test from "node:test";
import assert from "node:assert/strict";
import { Shape, Path, Matrix4, Vector2 } from "three";
import { DOMParser } from "@xmldom/xmldom";
import {
  parseSvg,
  buildMesh,
  exportObj,
  applyUvSettings,
} from "../src/geometry.js";

import { defaultProfile, moveProfileHandle } from "../src/bevel-profile.js";
import {
  prepareOffsetBevelRoof,
  triangulateOffsetBevelRoof,
} from "../src/offset-bevel-roof.js";

globalThis.DOMParser = DOMParser;

test("nonuniform outline sampling retains longitudinal bevel vertices without wide triangle fans", () => {
  const count = 400;
  const ring = Array.from({ length: count }, (_, i) => {
    const angle = 2 * Math.PI * (i / count) ** 3;
    return new Vector2(50 * Math.cos(angle), 50 * Math.sin(angle));
  });
  const longestSourceEdge = Math.max(
    ...ring.map((p, i) => p.distanceTo(ring[(i + 1) % count])),
  );
  const roof = prepareOffsetBevelRoof([ring]);
  for (const segments of [2, 8]) {
    const samples = Array.from(
      { length: segments + 1 },
      (_, i) => i / segments,
    );
    const triangles = triangulateOffsetBevelRoof(roof, 2, samples, (t) => t);
    const boundary = new Map();
    const faceIncidence = new Map();
    for (const triangle of triangles) {
      if (triangle.faceIndex !== 0) {
        for (const p of triangle.points) {
          // The closure joins a tiny edge to the longest edge. Its inset
          // legitimately removes several tiny edges, so exclude that corner
          // when measuring correspondence on the unchanged smooth contour.
          if (Math.abs(Math.atan2(p.y, p.x)) < 0.1) continue;
          const key = `${p.x},${p.y},${p.height}`;
          faceIncidence.set(key, (faceIncidence.get(key) ?? 0) + 1);
        }
      }
      for (let i = 0; i < 3; i++) {
        const a = triangle.points[i],
          b = triangle.points[(i + 1) % 3];
        if (a.height === 1) boundary.set(`${a.x},${a.y}`, a);
        if (triangle.faceIndex === 0 || a.height !== b.height) continue;
        assert.ok(
          Math.hypot(a.x - b.x, a.y - b.y) <= longestSourceEdge * 1.2,
          `bevel segments ${segments} must not merge local outline edges into long diagonals`,
        );
      }
    }
    assert.ok(
      Math.max(...faceIncidence.values()) <= 10,
      `smooth offsets retain local correspondence rather than concentrating triangles in a fan (${Math.max(...faceIncidence.values())})`,
    );
    for (const p of ring) {
      assert.ok(
        [...boundary.values()].some(
          (q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-7,
        ),
        `the source outline vertex ${p.x},${p.y} survives without reduction`,
      );
    }
  }
});

test("nonuniform hollow bevel bands share cap and body boundaries and export editable UVs", () => {
  const shape = new Shape();
  for (let i = 0; i < 128; i++) {
    const angle = 2 * Math.PI * (i / 128) ** 1.5;
    const x = 50 * Math.cos(angle),
      y = 50 * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  for (const bevelContinue of [false, true]) {
    const geometry = buildMesh(shape, {
      depth: 12,
      bevelSize: 6,
      bevelWidth: 1,
      hollow: true,
      wallThickness: 3,
      bevelContinue,
      bevelSegments: 4,
      curvePoints: ridgeProfile,
    });
    assertClosedFiniteSolid(geometry);
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    assert.equal(positions.count, uv.count);
    applyUvSettings(geometry, { uvScale: 1.3, uvRotation: 20 });
    const result = exportObj([{ name: "nonuniform-bevel", geometry }]);
    assert.ok(!/NaN|Infinity/.test(result.obj));
    assert.match(result.obj, /^vt /m);
    assert.match(result.obj, /^f \d+\/\d+\/\d+/m);
  }
});

test("curved profile control points share the requested bevel resolution budget", () => {
  const shape = new Shape();
  const count = 128;
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * (i / count) ** 1.5;
    const point = [50 * Math.cos(angle), 50 * Math.sin(angle)];
    if (i === 0) shape.moveTo(...point);
    else shape.lineTo(...point);
  }
  shape.closePath();
  const settings = {
    depth: 12,
    bevelSize: 6,
    bevelWidth: 1,
    hollow: true,
    wallThickness: 3,
    bevelSegments: 8,
    curvePoints: defaultProfile(),
  };
  const geometry = buildMesh(shape, settings);
  assertClosedFiniteSolid(geometry);
  assert.ok(
    geometry.attributes.position.count <= 32000,
    `two Bezier spans must share eight bevel bands instead of independently doubling them (${geometry.attributes.position.count} vertices)`,
  );
  const linear = buildMesh(shape, { ...settings, curvePoints: ridgeProfile });
  assert.notDeepEqual(
    Array.from(geometry.attributes.position.array),
    Array.from(linear.attributes.position.array),
    "the curved profile remains different from a straight bevel",
  );
});

test("offset bevel triangles follow local curved contour slopes without diagonal dents", () => {
  const ring = Array.from({ length: 100 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 100;
    return new Vector2(50 * Math.cos(angle), 50 * Math.sin(angle));
  });
  const width = 2;
  for (const profile of [(t) => t, (t) => 1 - Math.cos((t * Math.PI) / 2)]) {
    const samples = Array.from({ length: 17 }, (_, i) => i / 16);
    const levels = samples.map((height) => ({
      height,
      inset: width * (1 - profile(height)),
    }));
    const triangles = triangulateOffsetBevelRoof(
      prepareOffsetBevelRoof([ring]),
      width,
      samples,
      profile,
    );
    let slopes = 0;
    for (const triangle of triangles) {
      if (triangle.faceIndex === 0) continue;
      slopes++;
      const center = triangle.points.reduce(
        (sum, p) => ({
          x: sum.x + p.x / 3,
          y: sum.y + p.y / 3,
          height: sum.height + p.height / 3,
        }),
        { x: 0, y: 0, height: 0 },
      );
      let distance = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((center.x - a.x) * dx + (center.y - a.y) * dy) /
              (dx * dx + dy * dy),
          ),
        );
        distance = Math.min(
          distance,
          Math.hypot(center.x - a.x - t * dx, center.y - a.y - t * dy),
        );
      }
      const upper = levels.findIndex((p, i) => i > 0 && distance >= p.inset);
      assert.ok(upper > 0, "the triangle lies in a sampled bevel band");
      const a = levels[upper - 1],
        b = levels[upper];
      const expectedHeight =
        a.height +
        ((b.height - a.height) * (a.inset - distance)) / (a.inset - b.inset);
      assert.ok(
        Math.abs(center.height - expectedHeight) < 0.002,
        `a bevel triangle must follow its local contour slope, not dent diagonally (${center.height} vs ${expectedHeight})`,
      );
    }
    assert.ok(slopes > 100, "the curved contour has actual bevel faces");
  }
});

test("curved hollow bevels keep joined normals and a closed solid across sampled bands", () => {
  for (const bevelContinue of [false, true]) {
    const geometry = buildMesh(fineCurvedBumpOutline(), {
      depth: 20,
      bevelSize: 10,
      bevelWidth: 1,
      bevelContinue,
      hollow: true,
      wallThickness: 3,
      bevelSegments: 16,
      curve: 1,
    });
    assertClosedFiniteSolid(geometry);
    assert.ok(geometry.userData.effectiveWallThickness >= 2.99);
    assert.ok(geometry.userData.effectiveBevel >= 0.99);
    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const shared = new Map();
    let compared = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      // On the finely sampled smooth bump, adjacent triangulation
      // faces share one shading normal even though the profile is curved.
      if (
        x > 1 ||
        y > -50.05 ||
        y < -50.95 ||
        z <= 0 ||
        z >= geometry.userData.effectiveBevelDepth - 1e-5
      )
        continue;
      const key = `${x},${y},${z}`;
      const normal = [normals.getX(i), normals.getY(i), normals.getZ(i)];
      if (shared.has(key)) {
        const other = shared.get(key);
        assert.ok(
          Math.hypot(...normal.map((v, axis) => v - other[axis])) < 1e-5,
          `the same smooth bevel vertex must not receive triangle-dependent normals (continue=${bevelContinue}, pos=${key}, n=${normal}, other=${other})`,
        );
        compared++;
      } else shared.set(key, normal);
    }
    assert.ok(
      compared > 5,
      "sampled bevel bands contain shared smooth vertices",
    );
  }
});

test("Illustrator SVG external DTD is accepted without entity expansion", () => {
  const svg =
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H20V20H0Z"/></svg>';
  assert.equal(parseSvg(svg).objects.length, 1);
  assert.throws(() =>
    parseSvg(
      '<!DOCTYPE svg [<!ENTITY data "x">]><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H20V20H0Z"/></svg>',
    ),
  );
});

function rectangleWithHole() {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(20, 0);
  shape.lineTo(20, 20);
  shape.lineTo(0, 20);
  shape.closePath();
  const hole = new Path();
  hole.moveTo(7, 7);
  hole.lineTo(7, 13);
  hole.lineTo(13, 13);
  hole.lineTo(13, 7);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

function triangleVertices(geometry) {
  const positions = geometry.getAttribute("position");
  const indices = geometry.index;
  const count = indices ? indices.count : positions.count;
  const triangles = [];
  for (let i = 0; i < count; i += 3) {
    triangles.push(
      [0, 1, 2].map((offset) => {
        const index = indices ? indices.getX(i + offset) : i + offset;
        return [
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        ];
      }),
    );
  }
  return triangles;
}

test("extruded caps preserve an interior hole and contain finite positions and UVs", () => {
  const geometry = buildMesh(rectangleWithHole(), { depth: 5, bevelSize: 0 });
  for (const name of ["position", "normal", "uv"]) {
    const attribute = geometry.getAttribute(name);
    assert.ok(attribute?.count > 0, `${name} exists`);
    assert.ok(
      Array.from(attribute.array).every(Number.isFinite),
      `${name} is finite`,
    );
  }
  assert.equal(
    geometry.getAttribute("uv").count,
    geometry.getAttribute("position").count,
  );
  const caps = triangleVertices(geometry).filter((t) =>
    t.every((p) => Math.abs(p[2] - t[0][2]) < 1e-6),
  );
  assert.ok(caps.length > 0);
  for (const triangle of caps) {
    const x = triangle.reduce((sum, p) => sum + p[0], 0) / 3;
    const y = -triangle.reduce((sum, p) => sum + p[1], 0) / 3;
    assert.ok(!(x > 7 && x < 13 && y > 7 && y < 13), "cap does not fill hole");
  }
});

test("SVG import preserves holes in compound paths", () => {
  const result = parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 0H20V20H0Z M7 7H13V13H7Z"/></svg>',
  );
  assert.ok(result.objects.length > 0);
  assert.equal(result.objects[0].shape.holes.length, 1);
});

test("invalid and empty SVG input cannot silently produce geometry", () => {
  for (const input of [
    "",
    "<html/>",
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  ]) {
    assert.throws(() => parseSvg(input));
  }
});

test("extrusion without bevel preserves a pointed vertex", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(10, 1);
  shape.lineTo(0, 2);
  shape.closePath();
  const geometry = buildMesh(shape, { depth: 4, bevelSize: 0 });
  const positions = geometry.getAttribute("position");
  assert.ok(
    Array.from({ length: positions.count }, (_, i) => i).some(
      (i) =>
        Math.abs(positions.getX(i) - 10) < 1e-6 &&
        Math.abs(positions.getY(i) + 1) < 1e-6,
    ),
  );
});

test("vertex modes and Bezier handles change intermediate bevel geometry", () => {
  const settings = { depth: 8, bevelSize: 1, bevelSegments: 8 };
  const points = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.4 },
    { x: 1, y: 1 },
  ];
  const linear = buildMesh(rectangleWithHole(), {
    ...settings,
    curvePoints: points,
  });
  const curved = buildMesh(rectangleWithHole(), {
    ...settings,
    curvePoints: [
      points[0],
      {
        ...points[1],
        mode: "bezier",
        in: { x: 0.3, y: 0.05 },
        out: { x: 0.7, y: 0.8 },
      },
      points[2],
    ],
  });
  const moved = buildMesh(rectangleWithHole(), {
    ...settings,
    curvePoints: [
      points[0],
      {
        ...points[1],
        mode: "bezier",
        in: { x: 0.3, y: 0.25 },
        out: { x: 0.7, y: 0.6 },
      },
      points[2],
    ],
  });
  assert.notDeepEqual(
    Array.from(linear.attributes.position.array),
    Array.from(curved.attributes.position.array),
  );
  assert.notDeepEqual(
    Array.from(moved.attributes.position.array),
    Array.from(curved.attributes.position.array),
  );
  for (const geometry of [linear, curved, moved])
    assert.ok(
      Array.from(geometry.attributes.position.array).every(Number.isFinite),
    );
});

test("UV transform applies rotation, scale, and translation without moving geometry", () => {
  const shape = rectangleWithHole();
  const baseline = buildMesh(shape, { depth: 5 });
  const transformed = buildMesh(shape, {
    depth: 5,
    uvScale: 2,
    uvRotation: 90,
    uvOffsetX: 3,
    uvOffsetY: 4,
  });
  assert.deepEqual(
    Array.from(baseline.getAttribute("position").array),
    Array.from(transformed.getAttribute("position").array),
  );
  const uv = baseline.getAttribute("uv"),
    result = transformed.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    assert.ok(Math.abs(result.getX(i) - (3 - uv.getY(i) * 2)) < 1e-5);
    assert.ok(Math.abs(result.getY(i) - (4 + uv.getX(i) * 2)) < 1e-5);
  }
});

test("OBJ faces reference valid vertex, UV, and normal indices across objects", () => {
  const geometry = buildMesh(rectangleWithHole(), { depth: 5 });
  const { obj, mtl } = exportObj([
    { name: "one", geometry, color: "#ff0000" },
    { name: "two", geometry, color: "#0000ff" },
  ]);
  const lines = obj.split("\n");
  const count = (prefix) =>
    lines.filter((line) => line.startsWith(prefix)).length;
  const limits = [count("v "), count("vt "), count("vn ")];
  assert.equal(count("usemtl "), 2);
  assert.equal(
    mtl.split("\n").filter((line) => line.startsWith("newmtl ")).length,
    2,
  );
  assert.ok(
    limits.every(
      (value) => value === geometry.getAttribute("position").count * 2,
    ),
  );
  const exportedNormals = lines
    .filter((line) => line.startsWith("vn "))
    .map((line) => line.slice(3).trim().split(/\s+/).map(Number));
  const normals = geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++) {
    [normals.getX(i), normals.getY(i), normals.getZ(i)].forEach(
      (value, axis) => {
        assert.ok(
          Math.abs(exportedNormals[i][axis] - value) < 1e-6,
          "exported normal matches mesh",
        );
      },
    );
  }
  for (const line of lines.filter((line) => line.startsWith("f "))) {
    const vertices = line.slice(2).trim().split(/\s+/);
    assert.equal(vertices.length, 3);
    for (const vertex of vertices)
      vertex
        .split("/")
        .map(Number)
        .forEach((index, kind) => {
          assert.ok(
            Number.isInteger(index) && index >= 1 && index <= limits[kind],
          );
        });
  }
});

test("solid with a hole has outward normals, positive volume, and closed edges", () => {
  const geometry = buildMesh(rectangleWithHole(), { depth: 5, bevelSize: 0 });
  const triangles = triangleVertices(geometry);
  const edges = new Map();
  let volume = 0;
  const key = (p) => p.map((v) => v.toFixed(5)).join(",");
  for (const [a, b, c] of triangles) {
    const cross = [
      b[1] * c[2] - b[2] * c[1],
      b[2] * c[0] - b[0] * c[2],
      b[0] * c[1] - b[1] * c[0],
    ];
    volume += a.reduce((sum, v, i) => sum + v * cross[i], 0) / 6;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const first = key(from),
        second = key(to);
      const edgeKey = [first, second].sort().join("|");
      const edge = edges.get(edgeKey) || { count: 0, direction: 0 };
      edge.count++;
      edge.direction += first < second ? 1 : -1;
      edges.set(edgeKey, edge);
    }
  }
  assert.ok(
    Math.abs(volume - (400 - 36) * 5) < 1e-5,
    `signed volume ${volume}`,
  );
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, "each edge has exactly two faces");
    assert.equal(
      edge.direction,
      0,
      "adjacent faces have opposite edge directions",
    );
  }
  const positions = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal");
  for (let i = 0; i < positions.count; i += 3) {
    const zs = [0, 1, 2].map((j) => positions.getZ(i + j));
    if (zs.every((z) => z === 0)) assert.ok(normals.getZ(i) < -0.99);
    if (zs.every((z) => z === 5)) assert.ok(normals.getZ(i) > 0.99);
  }
});

test("automatic hollow clamps a wall that collapses the contour", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(20, 0);
  shape.lineTo(20, 20);
  shape.lineTo(0, 20);
  shape.closePath();
  const clamped = buildMesh(shape, {
    depth: 5,
    hollow: true,
    wallThickness: 11,
  });
  assert.ok(clamped.userData.effectiveWallThickness > 0);
  assert.ok(clamped.userData.effectiveWallThickness < 10);
  assert.ok(clamped.userData.warnings.length > 0);
  assert.ok(
    Array.from(clamped.attributes.position.array).every(Number.isFinite),
  );
  const geometry = buildMesh(shape, {
    depth: 5,
    hollow: true,
    wallThickness: 2,
  });
  let volume = 0;
  for (const [a, b, c] of triangleVertices(geometry)) {
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  assert.ok(Math.abs(volume - (400 - 256) * 5) < 1e-5);
});

test("bevel at half depth generates no zero-area triangles", () => {
  const shape = rectangleWithHole();
  const geometry = buildMesh(shape, {
    depth: 2,
    bevelSize: 1,
    bevelSegments: 6,
  });
  for (const [a, b, c] of triangleVertices(geometry)) {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((value, i) => value - a[i]);
    const cross = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    assert.ok(Math.hypot(...cross) > 1e-8);
  }
});

test("custom profile changes sampled inset and invalid profile warns", () => {
  const shape = rectangleWithHole();
  const settings = { depth: 8, bevelSize: 1, bevelSegments: 4 };
  const linear = buildMesh(shape, settings);
  const custom = buildMesh(shape, {
    ...settings,
    curvePoints: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.2 },
      { x: 1, y: 1 },
    ],
  });
  assert.notDeepEqual(
    Array.from(linear.attributes.position.array),
    Array.from(custom.attributes.position.array),
  );
  const mid = triangleVertices(custom)
    .flat()
    .filter((p) => Math.abs(p[2] - 0.5) < 1e-6);
  assert.ok(
    mid.some((p) => Math.abs(p[0] - 0.8) < 1e-6 && Math.abs(p[1] + 0.8) < 1e-6),
  );
  const invalid = buildMesh(shape, {
    ...settings,
    curvePoints: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 0.2 },
    ],
  });
  assert.ok(invalid.userData.warnings.length > 0);
  assert.deepEqual(
    Array.from(invalid.attributes.position.array),
    Array.from(linear.attributes.position.array),
  );
});

test("UV atlas separates caps, outer side, and hole side", () => {
  const g = buildMesh(rectangleWithHole(), { depth: 5 });
  const p = g.attributes.position,
    uv = g.attributes.uv,
    boxes = new Map();
  for (let i = 0; i < p.count; i += 3) {
    const vs = [0, 1, 2].map((j) => [
      p.getX(i + j),
      p.getY(i + j),
      p.getZ(i + j),
    ]);
    const kind = vs.every((v) => v[2] === 0)
      ? "bottom"
      : vs.every((v) => v[2] === 5)
        ? "top"
        : vs.every((v) => v[0] >= 7 && v[0] <= 13 && v[1] >= -13 && v[1] <= -7)
          ? "hole"
          : "outer";
    const box = boxes.get(kind) || [Infinity, Infinity, -Infinity, -Infinity];
    for (let j = 0; j < 3; j++) {
      box[0] = Math.min(box[0], uv.getX(i + j));
      box[1] = Math.min(box[1], uv.getY(i + j));
      box[2] = Math.max(box[2], uv.getX(i + j));
      box[3] = Math.max(box[3], uv.getY(i + j));
    }
    boxes.set(kind, box);
  }
  assert.equal(boxes.size, 4);
  const bounds = Array.from(boxes.values());
  for (let i = 0; i < bounds.length; i++)
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i],
        b = bounds[j];
      assert.ok(
        a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1],
        "UV islands do not overlap",
      );
    }
});

test("UV vertex edits affect matching keys only and precede transforms", () => {
  const shape = rectangleWithHole(),
    baseline = buildMesh(shape, { depth: 5 });
  const keys = baseline.userData.uvKeys,
    original = baseline.attributes.uv;
  assert.equal(keys.length, original.count);
  const selected = keys[0],
    edits = { [selected]: [0.25, 0.75] };
  const edited = buildMesh(shape, { depth: 5, uvEdits: edits }),
    uv = edited.attributes.uv;
  assert.deepEqual(
    Array.from(edited.attributes.position.array),
    Array.from(baseline.attributes.position.array),
  );
  for (let i = 0; i < keys.length; i++) {
    const expected =
      keys[i] === selected
        ? [0.25, 0.75]
        : [original.getX(i), original.getY(i)];
    assert.ok(
      Math.abs(uv.getX(i) - expected[0]) < 1e-6 &&
        Math.abs(uv.getY(i) - expected[1]) < 1e-6,
    );
  }
  const transformed = buildMesh(shape, {
    depth: 5,
    uvEdits: edits,
    uvScaleX: 2,
    uvScaleY: 3,
    uvRotation: 90,
    uvOffsetX: 1,
    uvOffsetY: 2,
  }).attributes.uv;
  for (let i = 0; i < keys.length; i++) {
    assert.ok(Math.abs(transformed.getX(i) - (1 - uv.getY(i) * 2)) < 1e-5);
    assert.ok(Math.abs(transformed.getY(i) - (2 + uv.getX(i) * 3)) < 1e-5);
  }
  assert.throws(() => buildMesh(shape, { uvEdits: { [selected]: [NaN, 0] } }));
});

test("multi-vertex profile preserves narrow bends at low bevel resolution", () => {
  const curvePoints = [
    { x: 0, y: 0 },
    { x: 0.13, y: 0.05 },
    { x: 0.19, y: 0.7 },
    { x: 0.73, y: 0.85 },
    { x: 1, y: 1 },
  ];
  const geometry = buildMesh(rectangleWithHole(), {
    depth: 8,
    bevelSize: 1,
    bevelSegments: 2,
    curvePoints,
  });
  const vertices = triangleVertices(geometry).flat();
  for (const point of curvePoints) {
    for (const z of [point.x, 8 - point.x]) {
      assert.ok(
        vertices.some(
          (v) =>
            Math.abs(v[2] - z) < 1e-6 &&
            Math.abs(v[0] - (1 - point.y)) < 1e-6 &&
            Math.abs(v[1] + (1 - point.y)) < 1e-6,
        ),
        `control bend (${point.x}, ${point.y}) survives on both bevel ends`,
      );
    }
  }
  assert.ok(
    vertices.some((v) => Math.abs(v[2] - 0.5) < 1e-6),
    "uniform samples remain between custom control points",
  );
  assert.ok(
    Array.from(geometry.attributes.position.array).every(Number.isFinite),
  );
});

function objVectors(obj, prefix) {
  return obj
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).split(/\s+/).map(Number));
}
test("OBJ applies object translation and pivoted rotation to vertices", () => {
  const geometry = buildMesh(rectangleWithHole(), { depth: 5, bevelSize: 0 });
  const matrix = new Matrix4()
    .makeTranslation(30, 40, 2)
    .multiply(new Matrix4().makeRotationZ(Math.PI / 2))
    .multiply(new Matrix4().makeTranslation(-10, 10, -2.5));
  const { obj } = exportObj([{ name: "pivot", geometry, matrix }]);
  const vertices = objVectors(obj, "v "),
    p = geometry.attributes.position;
  vertices.forEach((v, i) => {
    const expected = [
      30 - (p.getY(i) + 10),
      40 + (p.getX(i) - 10),
      p.getZ(i) - 0.5,
    ];
    expected.forEach((value, axis) =>
      assert.ok(Math.abs(v[axis] - value) < 1e-5),
    );
  });
});
test("OBJ normals use inverse transpose for rotated nonuniform scale", () => {
  const geometry = buildMesh(rectangleWithHole(), {
    depth: 5,
    bevelSize: 1,
    bevelSegments: 4,
  });
  const matrix = new Matrix4()
    .makeRotationZ(Math.PI / 2)
    .multiply(new Matrix4().makeScale(2, 3, 4));
  const { obj } = exportObj([{ geometry, matrix }]);
  const exported = objVectors(obj, "vn "),
    n = geometry.attributes.normal;
  exported.forEach((v, i) => {
    const expected = [-n.getY(i) / 3, n.getX(i) / 2, n.getZ(i) / 4],
      length = Math.hypot(...expected);
    expected.forEach((value, axis) =>
      assert.ok(Math.abs(v[axis] - value / length) < 1e-5),
    );
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-5);
  });
});

function denseRectangle(size = 100, divisions = 50) {
  const shape = new Shape();
  shape.moveTo(0, 0);
  for (const [ax, ay, bx, by] of [
    [0, 0, size, 0],
    [size, 0, size, size],
    [size, size, 0, size],
    [0, size, 0, 0],
  ])
    for (let i = 1; i <= divisions; i++)
      shape.lineTo(
        ax + ((bx - ax) * i) / divisions,
        ay + ((by - ay) * i) / divisions,
      );
  shape.closePath();
  return shape;
}

test("dense imported straight contours retain a working bevel and hollow", () => {
  for (const hollow of [false, true]) {
    const geometry = buildMesh(denseRectangle(), {
      depth: 24,
      bevelSize: 3,
      bevelSegments: 5,
      hollow,
      wallThickness: 4,
    });
    assert.ok(
      geometry.userData.effectiveBevel > (hollow ? 0 : 2.9),
      "dense straight segments must not silently disable the bevel",
    );
    assert.ok(
      Array.from(geometry.attributes.position.array).every(Number.isFinite),
    );
    assert.ok(
      triangleVertices(geometry)
        .flat()
        .some((v) => v[2] > 0 && v[2] < 3),
      "intermediate bevel layers exist",
    );
  }
});

test("path reduction removes redundant vertices while preserving corners and holes", () => {
  const shape = denseRectangle();
  shape.holes.push(rectangleWithHole().holes[0]);
  const baseline = buildMesh(shape, {
    depth: 5,
    bevelSize: 0,
    reductionTolerance: 0,
  });
  const reduced = buildMesh(shape, {
    depth: 5,
    bevelSize: 0,
    reductionTolerance: 0.1,
  });
  assert.ok(reduced.userData.reducedCount < reduced.userData.originalCount);
  for (const geometry of [baseline, reduced]) {
    geometry.computeBoundingBox();
    assert.equal(geometry.boundingBox.min.x, 0);
    assert.equal(geometry.boundingBox.max.x, 100);
    assert.equal(geometry.boundingBox.min.y, -100);
    assert.ok(Math.abs(geometry.boundingBox.max.y) < 1e-6);
    const caps = triangleVertices(geometry).filter((t) =>
      t.every((p) => Math.abs(p[2] - t[0][2]) < 1e-6),
    );
    for (const triangle of caps) {
      const x = triangle.reduce((n, p) => n + p[0], 0) / 3;
      const y = -triangle.reduce((n, p) => n + p[1], 0) / 3;
      assert.ok(
        !(x > 7 && x < 13 && y > 7 && y < 13),
        "reduction preserves holes",
      );
    }
  }
});

test("path reduction retains an arrow tip and rejects nonfinite tolerance", () => {
  const shape = parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L30 0L30 -10L50 5L30 20L30 10L0 10Z"/></svg>',
  ).objects[0].shape;
  const geometry = buildMesh(shape, {
    depth: 5,
    bevelSize: 0,
    reductionTolerance: 0.5,
  });
  const p = geometry.attributes.position;
  assert.ok(
    Array.from({ length: p.count }, (_, i) => i).some(
      (i) => p.getX(i) === 50 && p.getY(i) === -5,
    ),
    "sharp arrow tip survives",
  );
  assert.throws(() => buildMesh(shape, { reductionTolerance: NaN }));
});

function denseCircle(count = 400) {
  const shape = new Shape();
  for (let i = 0; i < count; i++) {
    const angle = (i * Math.PI * 2) / count;
    const x = 100 + 100 * Math.cos(angle),
      y = 100 + 100 * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

test("curve reduction stays within the requested silhouette tolerance", () => {
  const shape = denseCircle();
  const tolerance = 0.5;
  const geometry = buildMesh(shape, {
    depth: 5,
    bevelSize: 0,
    reductionTolerance: tolerance,
  });
  assert.ok(
    geometry.userData.reducedCount < geometry.userData.originalCount / 2,
  );
  const caps = triangleVertices(geometry).filter((t) =>
    t.every((p) => p[2] === 0),
  );
  const edges = new Map();
  for (const t of caps)
    for (let i = 0; i < 3; i++) {
      const a = t[i],
        b = t[(i + 1) % 3];
      const key = [a.slice(0, 2).join(","), b.slice(0, 2).join(",")]
        .sort()
        .join("|");
      const value = edges.get(key) || { count: 0, a, b };
      value.count++;
      edges.set(key, value);
    }
  const boundary = [...edges.values()].filter((e) => e.count === 1);
  for (let i = 0; i < 400; i++) {
    const angle = (i * Math.PI * 2) / 400,
      x = 100 + 100 * Math.cos(angle),
      y = -(100 + 100 * Math.sin(angle));
    const distance = Math.min(
      ...boundary.map(({ a, b }) => {
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const u = Math.max(
          0,
          Math.min(
            1,
            ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy),
          ),
        );
        return Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy);
      }),
    );
    assert.ok(
      distance <= tolerance + 0.0001,
      `silhouette deviation ${distance} exceeds tolerance`,
    );
  }
});

test("extreme reduction falls back without collapsing a smooth contour", () => {
  const shape = denseCircle(100);
  const geometry = buildMesh(shape, { depth: 5, reductionTolerance: 1000 });
  assert.ok(geometry.userData.reducedCount >= 3);
  assert.ok(geometry.userData.warnings.length > 0);
  assert.ok(
    Array.from(geometry.attributes.position.array).every(Number.isFinite),
  );
});

test("in-place UV updates match full builds and restore original UVs without replacing geometry", () => {
  const shape = rectangleWithHole(),
    geometry = buildMesh(shape, { depth: 5, bevelSize: 1 });
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal,
    uv = geometry.attributes.uv;
  const positions = Array.from(position.array),
    normals = Array.from(normal.array),
    originalUV = Array.from(uv.array);
  const settings = {
    depth: 5,
    bevelSize: 1,
    uvScaleX: 2.3,
    uvScaleY: 0.7,
    uvRotation: 23,
    uvOffsetX: 0.14,
    uvOffsetY: -0.3,
    uvEdits: { [geometry.userData.uvKeys[0]]: [0.2, 0.4] },
  };
  applyUvSettings(geometry, settings);
  assert.deepEqual(
    Array.from(uv.array),
    Array.from(buildMesh(shape, settings).attributes.uv.array),
  );
  applyUvSettings(geometry, {});
  assert.deepEqual(Array.from(uv.array), originalUV);
  assert.equal(geometry.attributes.position, position);
  assert.equal(geometry.attributes.normal, normal);
  assert.equal(geometry.attributes.uv, uv);
  assert.deepEqual(Array.from(position.array), positions);
  assert.deepEqual(Array.from(normal.array), normals);
});

test("maximum bevel retains a substantial wall around narrow imported holes", () => {
  const shape = parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 0H40V40H0Z M1 1V39H39V1Z"/></svg>',
  ).objects[0].shape;
  const geometry = buildMesh(shape, {
    depth: 24,
    bevelSize: 12,
    bevelSegments: 5,
    sharpCorners: true,
  });
  assert.ok(
    geometry.userData.effectiveBevelDepth <= geometry.userData.effectiveBevel,
  );
  assert(
    geometry.userData.effectiveBevel > 0 &&
      geometry.userData.effectiveBevel <= 0.5,
  );
  for (const name of ["position", "normal", "uv"])
    assert(Array.from(geometry.attributes[name].array).every(Number.isFinite));
  const triangles = triangleVertices(geometry);
  const edges = new Map();
  const key = (p) => p.map((v) => v.toFixed(5)).join(",");
  let sideEdgeCount = 0;
  for (const tri of triangles) {
    const [a, b, c] = tri;
    const ab = b.map((v, i) => v - a[i]),
      ac = c.map((v, i) => v - a[i]);
    assert(
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ) > 1e-9,
      "No zero-area triangles",
    );
    for (let i = 0; i < 3; i++) {
      const edge = [key(tri[i]), key(tri[(i + 1) % 3])].sort().join("|");
      edges.set(edge, (edges.get(edge) || 0) + 1);
      if (Math.abs(tri[i][2] - tri[(i + 1) % 3][2]) >= 12) sideEdgeCount++;
    }
  }
  assert(sideEdgeCount > 0, "Imported hole retains axial side wall thickness");
  assert(
    [...edges.values()].every((n) => n === 2),
    "Mesh remains closed",
  );
  geometry.dispose();
});

function assertClosedFiniteSolid(geometry) {
  for (const name of ["position", "normal", "uv"])
    assert.ok(
      Array.from(geometry.attributes[name].array).every(Number.isFinite),
      `${name} finite`,
    );
  const edges = new Map();
  const key = (p) => p.map((v) => Math.round(v * 100000)).join(",");
  let volume = 0;
  for (const [a, b, c] of triangleVertices(geometry)) {
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    const ab = b.map((v, i) => v - a[i]),
      ac = c.map((v, i) => v - a[i]);
    assert.ok(
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ) > 1e-9,
      "nondegenerate triangles",
    );
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const first = key(from),
        second = key(to),
        edgeKey = [first, second].sort().join("|");
      const entry = edges.get(edgeKey) || { count: 0, direction: 0 };
      entry.count++;
      entry.direction += first < second ? 1 : -1;
      edges.set(edgeKey, entry);
    }
  }
  assert.ok(volume > 0, `positive signed volume ${volume}`);
  for (const entry of edges.values()) {
    assert.equal(entry.count, 2, "closed two-face edges");
    assert.equal(entry.direction, 0, "consistent face orientation");
  }
}

const ridgeProfile = [
  { x: 0, y: 0, mode: "linear" },
  { x: 0.5, y: 0.5, mode: "linear" },
  { x: 1, y: 1, mode: "linear" },
];

test("maximum full-width L bevel forms narrow central ridges and straight sloping faces", () => {
  const shape = parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H36V140H130V176H0Z"/></svg>',
  ).objects[0].shape;
  for (const depth of [24, 8]) {
    const geometry = buildMesh(shape, {
      depth,
      bevelSize: depth / 2,
      bevelFullWidth: true,
      curvePoints: ridgeProfile,
      bevelSegments: 5,
    });
    assertClosedFiniteSolid(geometry);
    assert.ok(
      geometry.userData.effectiveBevel > 17.99 &&
        geometry.userData.effectiveBevel < 18,
      "full width reaches half the 36-unit stroke even with shallow extrusion",
    );
    assert.equal(geometry.userData.effectiveBevelDepth, depth / 2);
    const caps = triangleVertices(geometry).filter((t) =>
      t.every((p) => Math.abs(p[2]) < 1e-6),
    );
    const area = caps.reduce(
      (sum, [a, b, c]) =>
        sum +
        Math.abs(
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
        ) /
          2,
      0,
    );
    assert.ok(
      area < (36 * 176 + 94 * 36) * 0.01,
      `flat cap ${area} is below 1% of silhouette`,
    );
    const p = geometry.attributes.position;
    const middle = Array.from({ length: p.count }, (_, i) => [
      p.getX(i),
      p.getY(i),
      p.getZ(i),
    ]).filter((v) => Math.abs(v[2] - depth / 2) < 1e-6);
    assert.ok(
      middle.some((v) => v[0] === 0 && v[1] === 0),
      "outside pointed corner remains",
    );
    assert.ok(
      middle.some((v) => v[0] === 36 && v[1] === -140),
      "concave L elbow remains",
    );
    const normals = geometry.attributes.normal;
    assert.ok(
      Array.from({ length: normals.count }, (_, i) => i).some(
        (i) =>
          Math.abs(normals.getZ(i)) > 0.1 && Math.abs(normals.getZ(i)) < 0.99,
      ),
      "visible sloping faces",
    );
    geometry.dispose();
  }
});

test("full-width ridge bevel preserves compound holes and automatic hollow walls", () => {
  for (const hollow of [false, true]) {
    const shape = hollow ? denseRectangle(40, 4) : rectangleWithHole();
    const geometry = buildMesh(shape, {
      depth: 24,
      bevelSize: 12,
      bevelFullWidth: true,
      curvePoints: ridgeProfile,
      hollow,
      wallThickness: 4,
    });
    assertClosedFiniteSolid(geometry);
    assert.ok(geometry.userData.effectiveBevel > 0);
    for (const tri of triangleVertices(geometry)) {
      const x = tri.reduce((s, p) => s + p[0], 0) / 3,
        y = -tri.reduce((s, p) => s + p[1], 0) / 3;
      const [low, high] = hollow ? [4, 36] : [7, 13];
      assert.ok(
        !(x > low && x < high && y > low && y < high),
        "triangles do not cover the hole",
      );
    }
    geometry.dispose();
  }
});

test("Bezier handle modes preserve independence or aligned tangent", () => {
  const points = [
    { x: 0, y: 0 },
    {
      x: 0.5,
      y: 0.5,
      mode: "bezier",
      handleMode: "free",
      in: { x: 0.3, y: 0.4 },
      out: { x: 0.7, y: 0.6 },
    },
    { x: 1, y: 1 },
  ];
  const free = moveProfileHandle(points, 1, "in", { x: 0.3, y: 0.2 })[1];
  assert.deepEqual(free.out, points[1].out);
  points[1].handleMode = "aligned";
  const p = moveProfileHandle(points, 1, "in", { x: 0.3, y: 0.2 })[1],
    a = [p.in.x - p.x, p.in.y - p.y],
    b = [p.out.x - p.x, p.out.y - p.y];
  assert.ok(Math.abs(a[0] * b[1] - a[1] * b[0]) < 1e-12);
  assert.ok(a[0] * b[0] + a[1] * b[1] < 0);
  assert.ok(Math.abs(Math.hypot(...b) - Math.hypot(0.2, 0.1)) < 1e-12);
});

test("independent lateral bevel keeps axial meeting depth and increases front inset", () => {
  const shape = denseRectangle(100, 4);
  const narrow = buildMesh(shape, {
    depth: 8,
    bevelSize: 4,
    bevelWidth: 4,
    curvePoints: ridgeProfile,
  });
  const wide = buildMesh(shape, {
    depth: 8,
    bevelSize: 4,
    bevelWidth: 49.99,
    curvePoints: ridgeProfile,
  });
  for (const geometry of [narrow, wide]) {
    assertClosedFiniteSolid(geometry);
    assert.equal(geometry.userData.effectiveBevelDepth, 4);
  }
  assert.ok(wide.userData.effectiveBevel > 49.9);
  assert.ok(wide.userData.effectiveBevel > narrow.userData.effectiveBevel * 10);
  const frontArea = (geometry) =>
    triangleVertices(geometry)
      .filter((t) => t.every((p) => Math.abs(p[2]) < 1e-6))
      .reduce(
        (sum, [a, b, c]) =>
          sum +
          Math.abs(
            (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
          ) /
            2,
        0,
      );
  assert.ok(frontArea(wide) < frontArea(narrow) / 1000);
  assert.throws(() => buildMesh(shape, { bevelWidth: NaN }));
});

test("continued bevel crosses narrow-stroke collisions to join wider front faces", () => {
  const shape = parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H10V60H90V100H0Z"/></svg>',
  ).objects[0].shape;
  const normal = buildMesh(shape, {
    depth: 8,
    bevelSize: 4,
    bevelWidth: 20,
    curvePoints: ridgeProfile,
  });
  const continued = buildMesh(shape, {
    depth: 8,
    bevelSize: 4,
    bevelWidth: 20,
    bevelContinue: true,
    curvePoints: ridgeProfile,
  });
  assert.ok(
    normal.userData.effectiveBevel >= 19.9,
    "ordinary bevel also keeps its requested width after a local narrow-edge collision",
  );
  assertClosedFiniteSolid(normal);
  assert.equal(continued.userData.continuedBevel, true);
  assert.equal(continued.userData.effectiveBevel, 20);
  assert.equal(continued.userData.effectiveBevelDepth, 4);
  assertClosedFiniteSolid(continued);
  const front = triangleVertices(continued).filter((t) =>
    t.every((p) => Math.abs(p[2]) < 1e-6),
  );
  assert.equal(
    front.length,
    0,
    "maximum front bevel has no flat front cap even after narrow leg collision",
  );
  assert.ok(
    triangleVertices(continued)
      .flat()
      .some(
        (p) =>
          Math.abs(p[0] - 5) < 1e-6 &&
          Math.abs(p[1] + 65) < 1e-6 &&
          p[2] > 0 &&
          p[2] < 4,
      ),
    "narrow ridge rises before wider ridge",
  );
});

test("continued bevel rejects returning profiles while ordinary bevel allows them", () => {
  const shape = denseRectangle(100, 4);
  const settings = {
    depth: 8,
    bevelSize: 4,
    bevelWidth: 20,
    curvePoints: [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.8 },
      { x: 0.6, y: 0.2 },
      { x: 1, y: 1 },
    ],
  };
  assert.throws(
    () => buildMesh(shape, { ...settings, bevelContinue: true }),
    /戻らない/,
  );
  assertClosedFiniteSolid(
    buildMesh(shape, { ...settings, bevelContinue: false }),
  );
});

function assertWallBodyThickness(geometry, depth) {
  assertClosedFiniteSolid(geometry);
  const height = geometry.userData.effectiveBevelDepth;
  assert.ok(
    depth - 2 * height >= depth / 2 - 1e-6,
    "bevels leave at least half the extrusion as an axial wall",
  );
  const sideFaces = triangleVertices(geometry).filter((tri) => {
    const z = tri.map((p) => p[2]);
    return Math.max(...z) - Math.min(...z) >= depth / 2 - 1e-6;
  });
  assert.ok(
    sideFaces.length > 0,
    "actual side triangles retain substantial front/back separation",
  );
  let volume = 0;
  for (const [a, b, c] of triangleVertices(geometry))
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  return volume;
}

test("hollow walls keep their body when width equals its maximum, overshoots, or is automatic", () => {
  const paths = [
    "M0 0H100V100H0Z",
    "M0 0H36V140H130V176H0Z",
    "M0 0H5V100H100V105H0Z",
  ];
  for (const path of paths) {
    const shape = parseSvg(`<svg><path d="${path}"/></svg>`).objects[0].shape;
    for (const bevelContinue of [false, true]) {
      const base = {
        depth: 20,
        bevelSize: 10,
        bevelContinue,
        hollow: true,
        wallThickness: 3,
        curvePoints: ridgeProfile,
      };
      const probe = buildMesh(shape, { ...base, bevelWidth: 100 });
      const maximum = probe.userData.maximumBevelWidth;
      for (const bevelWidth of [
        maximum,
        maximum * 0.1,
        maximum * 3,
        undefined,
      ]) {
        const geometry = buildMesh(shape, { ...base, bevelWidth });
        assertWallBodyThickness(geometry, 20);
        assert.ok(
          geometry.userData.effectiveBevelDepth <=
            geometry.userData.effectiveBevel + 1e-6,
          "axial bevel stays proportional to the narrow wall",
        );
      }
    }
  }
  // Solid ridges still meet at the extrusion center; hollow protection does
  // not change the explicitly requested solid-font appearance.
  const solid = buildMesh(denseRectangle(100, 4), {
    depth: 20,
    bevelSize: 10,
    bevelWidth: 10,
    bevelContinue: true,
    curvePoints: ridgeProfile,
  });
  assert.equal(solid.userData.effectiveBevelDepth, 10);
  assertClosedFiniteSolid(solid);
});

test("hollow square preserves at least three quarters of its unbeveled wall volume at maximum width", () => {
  const geometry = buildMesh(denseRectangle(100, 4), {
    depth: 20,
    bevelSize: 10,
    bevelWidth: 1.5,
    bevelContinue: true,
    hollow: true,
    wallThickness: 3,
    curvePoints: ridgeProfile,
  });
  const volume = assertWallBodyThickness(geometry, 20);
  assert.ok(
    volume >= (100 * 100 - 94 * 94) * 20 * 0.75,
    "substantial wall body survives even though the front bevels meet",
  );
});

test("imported compound holes preserve wall thickness in both bevel modes", () => {
  for (const bevelContinue of [false, true]) {
    const shape = rectangleWithHole();
    const probe = buildMesh(shape, {
      depth: 20,
      bevelSize: 10,
      bevelWidth: 100,
      bevelContinue,
      curvePoints: ridgeProfile,
    });
    const geometry = buildMesh(shape, {
      depth: 20,
      bevelSize: 10,
      bevelWidth: probe.userData.maximumBevelWidth,
      bevelContinue,
      curvePoints: ridgeProfile,
    });
    assertWallBodyThickness(geometry, 20);
    assert.ok(geometry.userData.warnings.length > 0);
  }
});

test("OBJ preserves Unicode names and disambiguates renamed objects after sanitizing", () => {
  const geometry = buildMesh(denseRectangle(10, 4), { depth: 3, bevelSize: 0 });
  const { obj, mtl } = exportObj(
    ["彫刻 001", "彫刻 001", "彫刻_001_2", "彫刻 001"].map((name) => ({
      name,
      geometry,
    })),
  );
  const names = obj
    .split("\n")
    .filter((line) => line.startsWith("o "))
    .map((line) => line.slice(2));
  assert.deepEqual(names, [
    "彫刻_001",
    "彫刻_001_2",
    "彫刻_001_2_2",
    "彫刻_001_3",
  ]);
  assert.equal(new Set(names).size, 4);
  assert.equal((mtl.match(/^newmtl /gm) || []).length, 4);
});

function fineCurvedBumpOutline() {
  const shape = new Shape();
  shape.moveTo(0, 0);
  for (const point of [
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 51],
  ])
    shape.lineTo(...point);
  // A smooth, tiny outward bump contains edges that legitimately disappear
  // from the inset. It must not shrink every wall of the imported outline.
  for (let i = 1; i <= 50; i++) {
    const t = i / 50;
    shape.lineTo(-0.1 * Math.sin(Math.PI * t) ** 2, 51 - t);
  }
  shape.lineTo(0, 0);
  shape.closePath();
  return shape;
}

function frontProjectedArea(geometry) {
  return triangleVertices(geometry)
    .filter((tri) => tri.every((point) => Math.abs(point[2]) < 1e-7))
    .reduce(
      (sum, [a, b, c]) =>
        sum +
        Math.abs(
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
        ) /
          2,
      0,
    );
}

test("fine curved outline details do not collapse the requested hollow front rim", () => {
  const shape = fineCurvedBumpOutline();
  const frontAreas = [];
  for (const reductionTolerance of [0, 0.1]) {
    const geometry = buildMesh(shape, {
      depth: 20,
      bevelSize: 0,
      hollow: true,
      wallThickness: 3,
      reductionTolerance,
    });
    assertClosedFiniteSolid(geometry);
    assert.ok(
      geometry.userData.effectiveWallThickness >= 2.99,
      "a short convex edge must not globally halve the requested wall",
    );
    const frontArea = frontProjectedArea(geometry);
    assert.ok(
      frontArea >= 1160 && frontArea <= 1170,
      `the front rim keeps its requested width (area ${frontArea})`,
    );
    frontAreas.push(frontArea);
    if (reductionTolerance === 0) {
      const positions = geometry.attributes.position;
      assert.ok(
        Array.from(
          { length: positions.count },
          (_, index) => Math.abs(positions.getX(index) + 0.1) < 1e-6,
        ).some(Boolean),
        "the original outer detail is preserved without reduction",
      );
      assert.equal(
        geometry.userData.reducedCount,
        geometry.userData.originalCount,
      );
    }
  }
  assert.ok(
    Math.abs(frontAreas[0] - frontAreas[1]) < 1,
    "reduction is not required to obtain a substantial front rim",
  );
});

test("fine curved hollow outlines retain requested bevel widths and actual sloped faces", () => {
  const shape = fineCurvedBumpOutline();
  for (const bevelContinue of [false, true]) {
    const exportedWidths = [];
    for (const bevelWidth of [0.4, 1]) {
      const geometry = buildMesh(shape, {
        depth: 20,
        bevelSize: 10,
        bevelWidth,
        bevelContinue,
        hollow: true,
        wallThickness: 3,
        curvePoints: ridgeProfile,
      });
      assertWallBodyThickness(geometry, 20);
      assert.ok(geometry.userData.effectiveWallThickness >= 2.99);
      assert.ok(
        geometry.userData.effectiveBevel >= bevelWidth * 0.99,
        `a local fine detail must not globally shrink requested width ${bevelWidth}`,
      );
      const slopedFrontArea = triangleVertices(geometry)
        .filter((tri) => {
          const z = tri.map((point) => point[2]);
          return Math.max(...z) <= 10 && Math.max(...z) - Math.min(...z) > 1e-6;
        })
        .reduce(
          (sum, [a, b, c]) =>
            sum +
            Math.abs(
              (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
            ) /
              2,
          0,
        );
      assert.ok(
        slopedFrontArea > bevelWidth * 500,
        `the front has visible bevel slopes rather than only metadata (${slopedFrontArea})`,
      );
      assert.ok(
        frontProjectedArea(geometry) > 300,
        "a modest bevel leaves a substantial flat front rim",
      );
      applyUvSettings(geometry, { uvScale: 1.2, uvRotation: 15 });
      const exported = exportObj([{ name: "fine-hollow", geometry }]);
      assert.ok(!/NaN|Infinity/.test(exported.obj));
      assert.match(exported.obj, /^vt /m);
      exportedWidths.push(exported.obj);
    }
    assert.notEqual(
      exportedWidths[0],
      exportedWidths[1],
      "changing lateral bevel width changes actual exported geometry",
    );
  }
});

test("hollow offsets can split an inner cavity without thinning the outer walls", () => {
  const shape = new Shape();
  const outline = [
    [0, 0],
    [40, 0],
    [40, 18],
    [60, 18],
    [60, 0],
    [100, 0],
    [100, 40],
    [60, 40],
    [60, 22],
    [40, 22],
    [40, 40],
    [0, 40],
  ];
  shape.moveTo(...outline[0]);
  for (const point of outline.slice(1)) shape.lineTo(...point);
  shape.closePath();
  for (const bevelContinue of [false, true]) {
    const geometry = buildMesh(shape, {
      depth: 20,
      bevelSize: 1,
      bevelWidth: 0.5,
      bevelContinue,
      hollow: true,
      wallThickness: 3,
      curvePoints: ridgeProfile,
    });
    assertClosedFiniteSolid(geometry);
    assert.ok(
      geometry.userData.effectiveWallThickness >= 2.99,
      "a narrow bridge may close internally without thinning both rooms",
    );
    const caps = triangleVertices(geometry).filter((tri) =>
      tri.every((p) => Math.abs(p[2]) < 1e-7),
    );
    for (const [x, y] of [
      [20, -20],
      [80, -20],
    ]) {
      assert.ok(
        !caps.some((triangle) => {
          const crosses = triangle.map((a, index) => {
            const b = triangle[(index + 1) % 3];
            return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
          });
          return (
            crosses.every((value) => value >= -1e-6) ||
            crosses.every((value) => value <= 1e-6)
          );
        }),
        "both resulting inner cavities remain open through the caps",
      );
    }
  }
});

test("a tiny acute hollow outline spike keeps its detail without suppressing the bevel", () => {
  const shape = new Shape();
  const outline = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 50.01],
    [-0.1, 50],
    [0, 49.99],
  ];
  shape.moveTo(...outline[0]);
  for (const point of outline.slice(1)) shape.lineTo(...point);
  shape.closePath();
  for (const bevelContinue of [false, true]) {
    const geometry = buildMesh(shape, {
      depth: 20,
      bevelSize: 10,
      bevelWidth: 1,
      bevelContinue,
      hollow: true,
      wallThickness: 3,
      curvePoints: ridgeProfile,
    });
    assertWallBodyThickness(geometry, 20);
    assert.ok(geometry.userData.effectiveBevel >= 0.99);
    assert.ok(geometry.userData.effectiveWallThickness >= 2.99);
    const positions = geometry.attributes.position;
    assert.ok(
      Array.from(
        { length: positions.count },
        (_, index) =>
          Math.abs(positions.getX(index) + 0.1) < 1e-6 &&
          Math.abs(positions.getY(index) + 50) < 1e-6,
      ).some(Boolean),
      "the acute original detail remains at the outer boundary",
    );
  }
});

test("fine curved imported compound holes retain bevel slopes with or without hollow enabled", () => {
  const shape = fineCurvedBumpOutline();
  const hole = new Path();
  hole.moveTo(3, 3);
  hole.lineTo(3, 97);
  hole.lineTo(97, 97);
  hole.lineTo(97, 3);
  hole.closePath();
  shape.holes.push(hole);
  for (const hollow of [false, true]) {
    for (const bevelContinue of [false, true]) {
      const geometry = buildMesh(shape, {
        depth: 20,
        bevelSize: 10,
        bevelWidth: 1,
        bevelContinue,
        hollow,
        wallThickness: 3,
        curvePoints: ridgeProfile,
      });
      assertWallBodyThickness(geometry, 20);
      assert.ok(
        geometry.userData.effectiveBevel >= 0.99,
        "imported holes support the requested width independently of automatic hollowing",
      );
      const frontArea = frontProjectedArea(geometry);
      assert.ok(
        frontArea > 300 && frontArea < 500,
        `a three-unit imported rim retains its flat front plus substantial slopes (${frontArea})`,
      );
      const positions = geometry.attributes.position;
      assert.ok(
        Array.from(
          { length: positions.count },
          (_, index) => Math.abs(positions.getX(index) + 0.1) < 1e-6,
        ).some(Boolean),
        "the original fine outer detail is retained",
      );
      assert.ok(
        !/NaN|Infinity/.test(
          exportObj([{ name: "imported-hole", geometry }]).obj,
        ),
      );
    }
  }
});

test("solid fine outline details retain requested bevel width and visible slopes without hollowing", () => {
  for (const bevelContinue of [false, true]) {
    const shape = fineCurvedBumpOutline();
    const baseline = buildMesh(shape, {
      depth: 20,
      bevelSize: 0,
      bevelWidth: 0,
      hollow: false,
      bevelContinue,
      curvePoints: ridgeProfile,
    });
    const baselineFrontArea = frontProjectedArea(baseline);
    let previousArea = 0;
    for (const bevelWidth of [0.4, 1, 3]) {
      const geometry = buildMesh(shape, {
        depth: 20,
        bevelSize: 10,
        bevelWidth,
        hollow: false,
        bevelContinue,
        curvePoints: ridgeProfile,
      });
      assertClosedFiniteSolid(geometry);
      assert.ok(
        geometry.userData.effectiveBevel >= bevelWidth * 0.99,
        "tiny outline details must not globally suppress a solid object's bevel",
      );
      const slopeArea = triangleVertices(geometry)
        .filter((tri) => {
          const z = tri.map((p) => p[2]);
          return Math.max(...z) <= 10 && Math.max(...z) - Math.min(...z) > 1e-6;
        })
        .reduce(
          (sum, [a, b, c]) =>
            sum +
            Math.abs(
              (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
            ) /
              2,
          0,
        );
      assert.ok(
        slopeArea > bevelWidth * 380,
        `solid bevel must have real sloping area at width ${bevelWidth}, got ${slopeArea}`,
      );
      assert.ok(
        slopeArea > previousArea * 1.5,
        "increasing lateral width must change actual geometry, not only its subdivisions",
      );
      assert.ok(
        frontProjectedArea(geometry) < baselineFrontArea - bevelWidth * 375,
        "the front cap must move inward as the solid bevel grows",
      );
      previousArea = slopeArea;
    }
  }
});

test("curved bevel bands choose local diagonals that avoid narrow triangle fans", () => {
  const ring = Array.from({ length: 96 }, (_, index) => {
    const angle = 2 * Math.PI * (index / 96) ** 1.6;
    return new Vector2(60 * Math.cos(angle), 35 * Math.sin(angle));
  });
  const triangles = triangulateOffsetBevelRoof(
    prepareOffsetBevelRoof([ring]),
    3,
    [0, 0.5, 1],
    (t) => t,
  );
  const edges = new Map();
  const constrained = new Set();
  const key = (p) => `${p.x.toFixed(7)},${p.y.toFixed(7)},${p.height}`;
  const orient = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const triangle of triangles) {
    if (triangle.faceIndex === 0) continue;
    for (const [a, b] of triangle.constraints || [])
      constrained.add([key(a), key(b)].sort().join("|"));
    for (let i = 0; i < 3; i++) {
      const a = triangle.points[i],
        b = triangle.points[(i + 1) % 3],
        c = triangle.points[(i + 2) % 3];
      const edgeKey = [key(a), key(b)].sort().join("|");
      if (!edges.has(edgeKey)) edges.set(edgeKey, []);
      edges.get(edgeKey).push({ a, b, c });
    }
  }
  let interiorEdges = 0;
  for (const [edgeKey, neighbors] of edges) {
    if (constrained.has(edgeKey)) continue;
    if (neighbors.length !== 2) continue;
    const [{ a, b, c }, { c: d }] = neighbors;
    // Constant-height edges delimit the requested bevel slices and are constraints.
    if (a.height === b.height) continue;
    if (
      orient(a, b, c) * orient(a, b, d) >= -1e-10 ||
      orient(c, d, a) * orient(c, d, b) >= -1e-10
    )
      continue;
    const ax = a.x - d.x,
      ay = a.y - d.y,
      bx = b.x - d.x,
      by = b.y - d.y,
      cx = c.x - d.x,
      cy = c.y - d.y;
    let determinant =
      (ax * ax + ay * ay) * (bx * cy - by * cx) -
      (bx * bx + by * by) * (ax * cy - ay * cx) +
      (cx * cx + cy * cy) * (ax * by - ay * bx);
    if (orient(a, b, c) < 0) determinant = -determinant;
    assert.ok(
      determinant <= 1e-5,
      `an unconstrained bevel diagonal must not create avoidable thin triangles (${determinant})`,
    );
    interiorEdges++;
  }
  assert.ok(
    interiorEdges > 100,
    "quality check covers interior bevel diagonals",
  );
});

function assertOpenDepthRay(geometry, x, y, description) {
  for (const triangle of triangleVertices(geometry)) {
    const [a, b, c] = triangle;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // Side walls parallel to the viewing ray do not cover an opening.
    if (Math.abs(area) < 1e-9) continue;
    const crosses = triangle.map((p, i) => {
      const q = triangle[(i + 1) % 3];
      return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    });
    assert.ok(
      !(crosses.every((v) => v >= -1e-8) || crosses.every((v) => v <= 1e-8)),
      description,
    );
  }
}

test("automatic hollow never silently becomes solid for an extremely oversized wall", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(40, 0);
  shape.lineTo(40, 40);
  shape.lineTo(0, 40);
  shape.closePath();
  for (const bevelContinue of [false, true]) {
    const geometry = buildMesh(shape, {
      depth: 20,
      hollow: true,
      wallThickness: 1e12,
      bevelSize: 10,
      bevelWidth: 100,
      bevelContinue,
      curvePoints: ridgeProfile,
    });
    assert.ok(
      geometry.userData.effectiveWallThickness > 0,
      "automatic wall clamping must retain a genuine cavity",
    );
    assertOpenDepthRay(
      geometry,
      20.123,
      -20.456,
      "no cap or bevel may cover the hollow opening",
    );
  }
});

test("hollow openings stay unobstructed through all bevel layers across parameter combinations", () => {
  const shape = new Shape();
  for (let i = 0; i < 80; i++) {
    const angle = (2 * Math.PI * i) / 80;
    const radius = 30 + 0.4 * Math.sin(angle * 11);
    const point = [radius * Math.cos(angle), radius * Math.sin(angle)];
    if (i === 0) shape.moveTo(...point);
    else shape.lineTo(...point);
  }
  shape.closePath();
  for (const bevelContinue of [false, true]) {
    for (const depth of [1, 20]) {
      for (const bevelWidth of [0, 0.5, 100]) {
        const geometry = buildMesh(shape, {
          hollow: true,
          wallThickness: 3,
          depth,
          bevelSize: depth / 2,
          bevelWidth,
          bevelContinue,
          bevelSegments: 4,
          curvePoints: ridgeProfile,
        });
        for (const [x, y] of [
          [0.123, -0.456],
          [10.321, 3.765],
          [-8.765, -9.321],
        ]) {
          assertOpenDepthRay(
            geometry,
            x,
            y,
            `opening survives width=${bevelWidth}, depth=${depth}, continue=${bevelContinue}`,
          );
        }
        geometry.dispose();
      }
    }
  }
});

test("split hollow cavities remain open through bevel faces at maximum width", () => {
  const shape = new Shape();
  const outline = [
    [0, 0],
    [40, 0],
    [40, 18],
    [60, 18],
    [60, 0],
    [100, 0],
    [100, 40],
    [60, 40],
    [60, 22],
    [40, 22],
    [40, 40],
    [0, 40],
  ];
  shape.moveTo(...outline[0]);
  for (const p of outline.slice(1)) shape.lineTo(...p);
  shape.closePath();
  for (const bevelContinue of [false, true]) {
    for (const bevelWidth of [0.5, 100]) {
      const geometry = buildMesh(shape, {
        hollow: true,
        wallThickness: 3,
        depth: 20,
        bevelSize: 10,
        bevelWidth,
        bevelContinue,
        bevelSegments: 4,
        curvePoints: ridgeProfile,
      });
      for (const [x, y] of [
        [20.123, -20.456],
        [80.123, -20.456],
        [10.123, -10.456],
        [90.123, -30.456],
      ]) {
        assertOpenDepthRay(
          geometry,
          x,
          y,
          `split cavity survives width=${bevelWidth}, continue=${bevelContinue}`,
        );
      }
      geometry.dispose();
    }
  }
});

test("small SVG contours keep a hole at the UI maximum wall thickness", () => {
  for (const bevelContinue of [false, true]) {
    const geometry = buildMesh(denseRectangle(0.08, 4), {
      depth: 0.2,
      hollow: true,
      wallThickness: 30,
      bevelSize: 0.1,
      bevelWidth: 0.03,
      bevelContinue,
      curvePoints: ridgeProfile,
    });
    assert.ok(geometry.userData.effectiveWallThickness > 0);
    assert.ok(geometry.userData.effectiveWallThickness < 0.04);
    assertClosedFiniteSolid(geometry);
    assertOpenDepthRay(
      geometry,
      0.04123,
      -0.03876,
      "the small contour remains open instead of reverting to a solid mesh",
    );
    assert.ok(
      geometry.userData.warnings.some((message) => message.includes("壁厚")),
    );
  }
});

function acuteStarOutline(importedHole = false) {
  const shape = new Shape();
  for (let i = 0; i <= 20; i++) {
    const angle = ((i % 20) * Math.PI) / 10;
    const radius = i % 2 ? 20 : 60;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  if (importedHole) {
    const hole = new Path();
    for (let i = 0; i <= 32; i++) {
      const angle = (-(i % 32) * Math.PI) / 16;
      const x = Math.cos(angle) * 10,
        y = Math.sin(angle) * 10;
      if (i === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    }
    shape.holes.push(hole);
  }
  return shape;
}

for (const importedHole of [false, true]) {
  for (const bevelContinue of [false, true]) {
    test(`acute hollow stars retain tips and avoid shelves (importedHole=${importedHole}, continue=${bevelContinue})`, () => {
      const geometry = buildMesh(acuteStarOutline(importedHole), {
        depth: 20,
        bevelSize: 5,
        bevelWidth: 100,
        bevelSegments: 4,
        bevelContinue,
        hollow: !importedHole,
        wallThickness: 5,
        sharpCorners: true,
        curvePoints: ridgeProfile,
      });
      assertClosedFiniteSolid(geometry);
      const height = geometry.userData.effectiveBevelDepth;
      assert.ok(
        height > 0,
        "a real bevel survives near disappearing acute branches",
      );
      let slopingFrontFaces = 0;
      for (const triangle of triangleVertices(geometry)) {
        const z = triangle.map((p) => p[2]);
        if (z.some((v) => v > height + 1e-5)) continue;
        const min = Math.min(...z),
          max = Math.max(...z);
        if (min <= 1e-5 || max >= height - 1e-5) continue;
        assert.ok(
          max - min > 1e-5,
          `a disappearing sharp branch must form a ridge instead of an intermediate horizontal shelf at ${min}`,
        );
        slopingFrontFaces++;
      }
      assert.ok(
        slopingFrontFaces > 10,
        "the bevel contains actual intermediate sloping faces",
      );
      const positions = triangleVertices(geometry).flat();
      for (let i = 0; i < 20; i++) {
        const angle = (i * Math.PI) / 10,
          radius = i % 2 ? 20 : 60;
        assert.ok(
          positions.some(
            (p) =>
              Math.hypot(
                p[0] - Math.cos(angle) * radius,
                p[1] + Math.sin(angle) * radius,
              ) < 1e-5,
          ),
          `source corner ${i} remains present without implicit path reduction`,
        );
      }
      geometry.dispose();
    });
  }
}

for (const bevelContinue of [false, true]) {
  test(`zigzag lightning with a hole preserves a closed ridge bevel (continue=${bevelContinue})`, () => {
    const points = [
      [-15, 0], [60, 0], [50, 15], [90, 30], [55, 35], [95, 60],
      [60, 65], [100, 90], [20, 90], [35, 75], [-5, 60], [30, 55],
      [-10, 30], [25, 25],
    ];
    const shape = new Shape();
    points.forEach(([x, y], i) =>
      i ? shape.lineTo(x, y) : shape.moveTo(x, y),
    );
    shape.closePath();
    const hole = new Path();
    for (let i = 0; i <= 16; i++) {
      const angle = (-(i % 16) * Math.PI) / 8;
      const x = 45 + 4 * Math.cos(angle),
        y = 45 + 4 * Math.sin(angle);
      if (i) hole.lineTo(x, y);
      else hole.moveTo(x, y);
    }
    shape.holes.push(hole);
    const geometry = buildMesh(shape, {
      depth: 20,
      bevelSize: 5,
      bevelWidth: 100,
      bevelSegments: 6,
      bevelContinue,
      sharpCorners: true,
      curvePoints: ridgeProfile,
    });
    assertClosedFiniteSolid(geometry);
    const height = geometry.userData.effectiveBevelDepth;
    for (const triangle of triangleVertices(geometry)) {
      const z = triangle.map((p) => p[2]);
      if (Math.min(...z) > 1e-5 && Math.max(...z) < height - 1e-5) {
        assert.ok(
          Math.max(...z) - Math.min(...z) > 1e-5,
          "no intermediate flat shelf where a zigzag branch disappears",
        );
      }
    }
    geometry.dispose();
  });
}

for (const importedHole of [false, true]) {
  test(`dense nonuniform curved hollow boundaries stay joined after wall edits (importedHole=${importedHole})`, () => {
    const count = 128;
    for (const lobes of [0, 3]) {
      const shape = new Shape();
      const outer = [];
      for (let i = 0; i < count; i++) {
        const angle = 2 * Math.PI * (i / count) ** 1.5;
        const radius = 100 * (1 + (lobes ? 0.2 * Math.cos(lobes * angle) : 0));
        const point = [radius * Math.cos(angle), radius * Math.sin(angle)];
        outer.push(point);
        if (i) shape.lineTo(...point);
        else shape.moveTo(...point);
      }
      shape.closePath();
      if (importedHole) {
        const hole = new Path();
        for (let i = 0; i < count; i++) {
          const angle = -2 * Math.PI * (i / count) ** 1.5;
          const point = [70 * Math.cos(angle), 70 * Math.sin(angle)];
          if (i) hole.lineTo(...point);
          else hole.moveTo(...point);
        }
        hole.closePath();
        shape.holes.push(hole);
      }
      for (const wallThickness of [17.031, 40]) {
        const geometry = buildMesh(shape, {
          depth: 64.01,
          bevelSize: 18.018,
          bevelWidth: 3.0247,
          bevelSegments: 6,
          bevelContinue: true,
          hollow: true,
          wallThickness,
          curvePoints: ridgeProfile,
        });
        assertClosedFiniteSolid(geometry);
        const positions = triangleVertices(geometry).flat();
        for (const [x, y] of outer) {
          assert.ok(
            positions.some((p) => Math.hypot(p[0] - x, p[1] + y) < 1e-5),
            "all un-reduced source boundary vertices remain shared with the body",
          );
        }
        assertOpenDepthRay(
          geometry,
          0.123,
          -0.456,
          "wall edits keep the cavity open across all bevel layers",
        );
        geometry.dispose();
      }
    }
  });
}

test("dense wavy compound contours cannot leave a gap between bevel and side wall", () => {
  const count = 128;
  const shape = new Shape();
  const outline = [];
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * (i / count) ** 1.5;
    const radius = 100 * (1 + 0.2 * Math.cos(11 * angle));
    const point = [radius * Math.cos(angle), radius * Math.sin(angle)];
    outline.push(point);
    if (i) shape.lineTo(...point);
    else shape.moveTo(...point);
  }
  shape.closePath();
  const hole = new Path();
  for (let i = 0; i < count; i++) {
    const angle = (-2 * Math.PI * i) / count + 0.123;
    const point = [65 * Math.cos(angle), 65 * Math.sin(angle)];
    if (i) hole.lineTo(...point);
    else hole.moveTo(...point);
  }
  hole.closePath();
  shape.holes.push(hole);
  const geometry = buildMesh(shape, {
    depth: 64.01,
    bevelSize: 18.018,
    bevelWidth: 3.0247,
    bevelSegments: 6,
    bevelContinue: true,
    hollow: true,
    wallThickness: 17.031,
    curvePoints: ridgeProfile,
  });
  assertClosedFiniteSolid(geometry);
  const positions = triangleVertices(geometry).flat();
  for (const [x, y] of outline) {
    assert.ok(
      positions.some((p) => Math.hypot(p[0] - x, p[1] + y) < 1e-5),
      "bevel repairs preserve every original outline vertex",
    );
  }
  assertOpenDepthRay(
    geometry,
    0.123,
    -0.456,
    "repair keeps the central cavity open",
  );
  geometry.dispose();
});
