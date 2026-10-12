import test from "node:test";
import assert from "node:assert/strict";
import { Shape, Path, Matrix4 } from "three";
import { DOMParser } from "@xmldom/xmldom";
import {
  parseSvg,
  buildMesh,
  exportObj,
  applyUvSettings,
} from "../src/geometry.js";

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
