import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

export function prepareObjectMesh(mesh, object) {
  mesh.geometry.computeBoundingBox();
  const geometryCenter = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  if (!object.pivot) {
    object.pivot = [geometryCenter.x, geometryCenter.y, 0];
  }
  object.transform ||= {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  // Each rebuilt extrusion is centered around its stable local origin. Existing
  // saved pivots still locate the object, without moving its center as depth changes.
  mesh.geometry.translate(-object.pivot[0], -object.pivot[1], -geometryCenter.z);
  apply(mesh, object);
}
function apply(mesh, object) {
  mesh.position
    .fromArray(object.pivot)
    .add(new THREE.Vector3().fromArray(object.transform.position));
  mesh.rotation.set(...object.transform.rotation, "XYZ");
  mesh.scale.fromArray(object.transform.scale);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
}

export function createTransformTools({
  scene,
  camera,
  renderer,
  orbit,
  group,
  getObjects,
  getSelected,
  onSelect,
  onChange = () => {},
}) {
  const toolbar = document.createElement("div");
  toolbar.className = "transform-toolbar";
  toolbar.innerHTML =
    '<span>オブジェクト操作</span><button id="transform-translate" class="active">移動 W</button><button id="transform-rotate">回転 E</button><button id="transform-scale">スケール R</button><label><input id="transform-local" type="checkbox">ローカル軸</label>';
  document.getElementById("viewport").before(toolbar);
  const panel = document.createElement("details");
  panel.className = "control-section transform-panel";
  panel.open = true;
  const axes = ["x", "y", "z"];
  panel.innerHTML =
    '<summary>位置・回転・スケール <span>TRANSFORM</span></summary><div class="fold-content">' +
    ["position", "rotation", "scale"]
      .map(
        (kind) =>
          `<div class="transform-fields"><span>${{ position: "位置", rotation: "回転 °", scale: "スケール" }[kind]}</span>${axes.map((axis) => `<label><input id="${kind}-${axis}" type="number" step="${kind === "rotation" ? 1 : 0.1}" ${kind === "scale" ? 'min="0.01"' : ""} value="${kind === "scale" ? 1 : 0}" aria-label="${kind} ${axis}"></label>`).join("")}</div>`,
      )
      .join("") +
    '<button id="transform-reset" class="subtle">位置・回転・スケールをリセット</button></div>';
  (
    document.getElementById("objects-details") ||
    document.getElementById("selected-name")
  ).after(panel);
  let controls = null,
    mode = "translate";
  if (renderer) {
    controls = new TransformControls(camera, renderer.domElement);
    controls.setSize(0.85);
    scene.add(controls.getHelper());
    controls.addEventListener("dragging-changed", (e) => {
      if (orbit) orbit.enabled = !e.value;
      if (!e.value) onChange(true);
    });
    controls.addEventListener("objectChange", () => {
      const mesh = controls.object,
        object = getObjects().find((o) => o.id === mesh?.userData.objectId);
      if (!object) return;
      mesh.scale.set(
        Math.max(0.01, mesh.scale.x),
        Math.max(0.01, mesh.scale.y),
        Math.max(0.01, mesh.scale.z),
      );
      object.transform = {
        position: mesh.position
          .clone()
          .sub(new THREE.Vector3().fromArray(object.pivot))
          .toArray(),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: mesh.scale.toArray(),
      };
      mesh.updateMatrix();
      syncNumbers();
      onChange();
    });
    const raycaster = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, gizmo: controls.axis !== null };
    });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (
        !down ||
        down.gizmo ||
        controls.dragging ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
      ) {
        down = null;
        return;
      }
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(
        group.children.filter((m) => m.visible),
        false,
      )[0];
      if (hit) onSelect(group.children.indexOf(hit.object));
    });
  }
  function activeObject() {
    return getObjects()[getSelected()];
  }
  function syncNumbers() {
    const o = activeObject();
    for (const kind of ["position", "rotation", "scale"])
      axes.forEach((axis, i) => {
        const input = document.getElementById(`${kind}-${axis}`);
        input.disabled = !o;
        input.value = o
          ? Number(
              (
                o.transform[kind][i] * (kind === "rotation" ? 180 / Math.PI : 1)
              ).toFixed(4),
            )
          : kind === "scale"
            ? 1
            : 0;
      });
  }
  function setMode(value) {
    mode = value;
    controls?.setMode(value);
    for (const m of ["translate", "rotate", "scale"])
      document
        .getElementById(`transform-${m}`)
        .classList.toggle("active", m === mode);
  }
  for (const m of ["translate", "rotate", "scale"])
    document.getElementById(`transform-${m}`).onclick = () => setMode(m);
  document.getElementById("transform-local").onchange = (e) =>
    controls?.setSpace(e.target.checked ? "local" : "world");
  for (const kind of ["position", "rotation", "scale"])
    axes.forEach((axis, i) => {
      const input = document.getElementById(`${kind}-${axis}`);
      input.oninput = () => {
        const o = activeObject(),
          mesh = group.children[getSelected()],
          value = Number(input.value);
        if (!o || !mesh || input.value === "" || !Number.isFinite(value))
          return;
        o.transform[kind][i] =
          kind === "rotation"
            ? (value * Math.PI) / 180
            : kind === "scale"
              ? Math.max(0.01, value)
              : value;
        apply(mesh, o);
        onChange();
      };
      input.onchange = () => {
        syncNumbers();
        onChange(true);
      };
    });
  document.getElementById("transform-reset").onclick = () => {
    const o = activeObject(),
      mesh = group.children[getSelected()];
    if (!o || !mesh) return;
    o.transform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    apply(mesh, o);
    syncNumbers();
    onChange(true);
  };
  window.addEventListener("keydown", (e) => {
    if (
      e.target.closest(
        "input,textarea,select,[contenteditable=true],.curve-display,.curve-dialog",
      ) ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return;
    const value = { w: "translate", e: "rotate", r: "scale" }[
      e.key.toLowerCase()
    ];
    if (value) {
      e.preventDefault();
      setMode(value);
    }
  });
  return {
    controls,
    detach() {
      controls?.detach();
      if (orbit) orbit.enabled = true;
    },
    sync() {
      const mesh = group.children[getSelected()];
      if (controls) {
        if (mesh && mesh.visible) controls.attach(mesh);
        else controls.detach();
      }
      syncNumbers();
    },
  };
}
