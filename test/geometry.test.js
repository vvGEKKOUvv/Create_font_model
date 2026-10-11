import test from "node:test";
import assert from "node:assert/strict";
import { Shape, Path } from "three";
import { DOMParser } from "@xmldom/xmldom";
import { parseSvg, buildMesh, exportObj } from "../src/geometry.js";

globalThis.DOMParser = DOMParser;

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

test("bevel curve control changes intermediate geometry", () => {
  const shape = rectangleWithHole();
  const settings = { depth: 8, bevelSize: 1, bevelSegments: 6 };
  const linear = buildMesh(shape, { ...settings, curve: 0 });
  const curved = buildMesh(shape, { ...settings, curve: 1 });
  assert.equal(
    linear.getAttribute("position").count,
    curved.getAttribute("position").count,
  );
  assert.notDeepEqual(
    Array.from(linear.getAttribute("position").array),
    Array.from(curved.getAttribute("position").array),
  );
  assert.ok(
    Array.from(curved.getAttribute("position").array).every(Number.isFinite),
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

test("automatic hollow rejects a wall that collapses the contour", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(20, 0);
  shape.lineTo(20, 20);
  shape.lineTo(0, 20);
  shape.closePath();
  assert.throws(() =>
    buildMesh(shape, { depth: 5, hollow: true, wallThickness: 11 }),
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
