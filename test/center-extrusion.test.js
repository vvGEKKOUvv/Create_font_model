import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, Shape, Vector3 } from "three";
import { buildMesh, exportObj } from "../src/geometry.js";
import { prepareObjectMesh } from "../src/transform-tools.js";

function geometry(depth) {
  const shape = new Shape();
  shape.moveTo(10, 20);
  shape.lineTo(30, 20);
  shape.lineTo(30, 40);
  shape.lineTo(10, 40);
  shape.closePath();
  return buildMesh(shape, { depth, bevelSize: 0, bevelWidth: 0 });
}
function centered(mesh, depth) {
  const box = mesh.geometry.boundingBox;
  assert.equal(box.min.z, -depth / 2);
  assert.equal(box.max.z, depth / 2);
}

test("extrusion grows symmetrically around the new object origin and exports both sides", () => {
  const object = {};
  const mesh = new Mesh(geometry(10));
  prepareObjectMesh(mesh, object);
  assert.equal(object.pivot[2], 0);
  centered(mesh, 10);
  const origin = mesh.position.clone();
  mesh.geometry = geometry(30);
  prepareObjectMesh(mesh, object);
  centered(mesh, 30);
  assert.deepEqual(mesh.position.toArray(), origin.toArray());
  const { obj } = exportObj([{ geometry: mesh.geometry, matrix: mesh.matrix }]);
  const z = obj.split("\n").filter(line => line.startsWith("v ")).map(line => Number(line.split(" ")[3]));
  assert.equal(Math.min(...z), -15);
  assert.equal(Math.max(...z), 15);
});

test("rotated and scaled extrusion retains its origin, including a saved legacy pivot", () => {
  const object = {
    pivot: [20, -30, 5],
    transform: { position: [3, 7, 11], rotation: [0.2, 0.6, -0.3], scale: [2, 0.5, 3] },
  };
  const mesh = new Mesh(geometry(10));
  prepareObjectMesh(mesh, object);
  const center = new Vector3().applyMatrix4(mesh.matrix);
  assert.deepEqual(center.toArray(), [23, -23, 16]);
  for (const depth of [30, 6]) {
    mesh.geometry = geometry(depth);
    prepareObjectMesh(mesh, object);
    centered(mesh, depth);
    const front = new Vector3(0, 0, depth / 2).applyMatrix4(mesh.matrix);
    const back = new Vector3(0, 0, -depth / 2).applyMatrix4(mesh.matrix);
    assert.ok(front.add(back).multiplyScalar(0.5).distanceTo(center) < 1e-12);
    assert.deepEqual(object.pivot, [20, -30, 5]);
  }
});
