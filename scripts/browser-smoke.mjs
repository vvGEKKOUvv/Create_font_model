import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const server = spawn(
  "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5184", "--strictPort"],
  { detached: true, stdio: "pipe" },
);
let output = "";
server.stdout.on("data", (b) => {
  output += b;
});
server.stderr.on("data", (b) => {
  output += b;
});
const work = await mkdtemp(join(tmpdir(), "path-form-smoke-"));
let browser;
try {
  await expect
    .poll(
      async () => {
        if (server.exitCode !== null) throw new Error(output);
        try {
          return (await fetch("http://127.0.0.1:5184")).ok;
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    )
    .toBe(true);
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Observe actual scene transforms without adding production-only test hooks.
  await page.route("**/src/main.js", async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    source = source.replace(
      /buildMesh\(o\.shape, o\.settings\)/g,
      "(window.__geometryBuilds = (window.__geometryBuilds || 0) + 1, buildMesh(o.shape, o.settings))",
    );
    source = source.replace("new THREE.WireframeGeometry(mesh.geometry)","(window.__wireframeBuilds = (window.__wireframeBuilds || 0) + 1, new THREE.WireframeGeometry(mesh.geometry))");
    assert(source.includes("renderer.render(scene, camera);"));
    await route.fulfill({
      response,
      body: source.replace(
        "renderer.render(scene, camera);",
        `scene.updateMatrixWorld(true);
       window.__sceneSnapshot = {
         environmentId: scene.environment?.uuid,
         environmentPreset,
         objects: group.children.map(mesh => ({
           metalness: mesh.material.metalness,
           roughness: mesh.material.roughness,
           geometryId: mesh.geometry.uuid,
           triangleCount: mesh.geometry.attributes.position.count / 3,
           bevelSamples: mesh.geometry.userData.bevelSamples,
           localZ: [mesh.geometry.boundingBox.min.z, mesh.geometry.boundingBox.max.z],
           wireframe: mesh.material.wireframe,
           colorWrite: mesh.material.colorWrite,
           occluder: Boolean(mesh.userData.wireframeOccluder?.visible),
           occluderGeometry: mesh.userData.wireframeOccluder?.geometry.uuid,
           visible: mesh.visible,
           overlay: Boolean(mesh.userData.wireframeOverlay?.visible),
           overlayCount: mesh.children.filter(c => c.isLineSegments).length,
           effectiveBevel: mesh.geometry.userData.effectiveBevel,
           effectiveWallThickness: mesh.geometry.userData.effectiveWallThickness,
           effectiveBevelDepth: mesh.geometry.userData.effectiveBevelDepth,
           centralWallDepth: mesh.geometry.userData.centralWallDepth,
           matrix: mesh.matrixWorld.toArray(),
           depth: mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z,
           point: new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0).applyMatrix4(mesh.matrixWorld).toArray()
         })),
         camera: camera.matrixWorld.toArray(),
         orbitEnabled: controls.enabled,
         dampingFactor: controls.dampingFactor,
         gizmo: {axis:transformControls.axis, dragging:transformControls.dragging, mode:transformControls.mode, position:transformControls.object?.position.toArray(), handles: transformControls._gizmo.gizmo.translate.children.filter(h=>h.name==='X' && h.visible && h.isMesh).map(h=> {
           h.geometry.computeBoundingBox();
           const p=h.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(h.matrixWorld).project(camera);
           const rect=renderer.domElement.getBoundingClientRect();
           return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};
         })},
         target: controls.target.toArray()
       };
       renderer.render(scene, camera);`,
      ),
    });
  });
  await page.goto("http://127.0.0.1:5184");
  await page.evaluate(() => { window.showDirectoryPicker = undefined; window.showSaveFilePicker = undefined; });
  await expect(page.locator("#object-count")).toHaveText("0");
  await expect(page.locator("#sample")).toHaveCount(0);
  await page.locator("#file").setInputFiles({
    name: "sample.svg",
    mimeType: "image/svg+xml",
    buffer: await readFile(new URL("../public/sample.svg", import.meta.url)),
  });
  await expect(page.locator("#object-count")).toHaveText("2");
  await expect(page.locator("#curve-point-mode")).toHaveValue("bezier");
  await expect(page.locator("#curve-handle-mode")).toHaveValue("aligned");
  await expect(page.locator('#curve-handle-mode option[value="aligned"]')).toHaveText("接線");

  await expect(page.locator("#viewport canvas")).toBeVisible();
  await expect(page.locator(".left-panel")).toHaveCount(0);
  await expect(page.locator(".right-panel #file")).toHaveCount(1);
  assert(
    (await page.locator("#dropzone").boundingBox()).height <= 80,
    "Import area is compact",
  );
  await expect(page.locator(".right-panel #objects")).toHaveCount(1);
  assert(
    await page
      .locator(".right-panel details")
      .evaluateAll((ds) => ds[1].id === "objects-details"),
    "Object selection immediately follows import",
  );
  const depthRange = await page.locator('[data-range="depth"]').boundingBox();
  const depthInput = await page.locator("#depth").boundingBox();
  assert(
    depthRange.x + depthRange.width <= depthInput.x &&
      Math.abs(
        depthRange.y +
          depthRange.height / 2 -
          depthInput.y -
          depthInput.height / 2,
      ) < 2,
    "Slider and numeric input share compact row, input on right",
  );
  await expect(
    page.getByText("パスから、かたちへ。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#tab-3d")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-uv")).toBeHidden();
  await page.locator("#tab-uv").click();
  await expect(page.locator("#tab-uv")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#uv-canvas")).toBeVisible();
  await expect(page.locator("#view-3d")).toBeHidden();
  await page.locator("#tab-3d").click();
  await expect(page.locator("#viewport canvas")).toBeVisible();
  assert(
    await page
      .locator(".transform-fields label")
      .evaluateAll((labels) =>
        labels.every((label) => !/[XYZ]/.test(label.textContent)),
      ),
    "Transform fields omit visible XYZ labels",
  );
  await expect(page.locator("#position-x")).toHaveAttribute(
    "aria-label",
    "position x",
  );
  const rightDetails = page.locator(".right-panel details");
  assert(
    (await rightDetails.count()) >= 7,
    "All right panel groups are collapsible",
  );
  assert(
    await page
      .locator(".right-panel")
      .evaluate((panel) =>
        [...panel.querySelectorAll("input, select")].every((input) =>
          input.closest("details"),
        ),
      ),
    "All right panel inputs belong to collapsible groups",
  );
  await rightDetails.evaluateAll((details) =>
    details.forEach((detail) => {
      detail.open = false;
    }),
  );
  await expect(page.locator("#depth")).toBeHidden();
  await expect(page.locator("#objects")).toBeHidden();
  await expect(page.locator("#viewport canvas")).toBeVisible();
  await rightDetails.evaluateAll((details) =>
    details.forEach((detail) => {
      detail.open = true;
    }),
  );
  await expect(page.locator("#depth")).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.__sceneSnapshot.dampingFactor),
    0.35,
    "Orbit damping settles rapidly after pointer release",
  );
  const snapshot = await page.locator("#viewport canvas").evaluate(
    (c) =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const target = document.createElement("canvas");
          target.width = c.width;
          target.height = c.height;
          const context = target.getContext("2d");
          context.drawImage(c, 0, 0);
          resolve(
            [...context.getImageData(0, 0, c.width, c.height).data].some(
              (n, i) => i % 4 !== 3 && n > 60,
            ),
          );
        }),
      ),
  );
  assert(snapshot, "WebGL canvas should contain rendered geometry");
  let iteration = 0;
  async function exported() {
    const downloads = [];
    const collect = (d) => downloads.push(d);
    page.on("download", collect);
    try {
      await page.locator("#export").click();
      await expect
        .poll(async () => {
          if (
            await page
              .locator("#message")
              .evaluate((el) => el.classList.contains("error"))
          )
            throw new Error(await page.locator("#message").textContent());
          return downloads.length;
        })
        .toBe(2);
      const result = {};
      for (const download of downloads) {
        const name = download.suggestedFilename();
        const path = join(work, `${iteration}-${name}`);
        await download.saveAs(path);
        result[name] = await readFile(path, "utf8");
      }
      iteration++;
      return result;
    } finally {
      page.off("download", collect);
    }
  }
  const beforeWireframe = await page.evaluate(
    () => window.__sceneSnapshot.objects,
  );
  const wireframeBaseline = await exported();
  await page.locator("#wireframe").check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sceneSnapshot.objects.every((o) => o.wireframe),
      ),
    )
    .toBe(true);
  const wireframeExport = await exported();
  assert.equal(
    wireframeExport["model.obj"],
    wireframeBaseline["model.obj"],
    "Wireframe changes display only, never exported geometry",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.__sceneSnapshot.objects.map((o) => o.geometryId),
    ),
    beforeWireframe.map((o) => o.geometryId),
    "Wireframe toggling reuses geometry",
  );
  await page.locator("#wireframe-mode").selectOption("overlay");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sceneSnapshot.objects.every(
          (o) => !o.wireframe && o.overlay && o.overlayCount === 1,
        ),
      ),
    )
    .toBe(true);
  assert.equal(
    (await exported())["model.obj"],
    wireframeBaseline["model.obj"],
    "Overlay never changes OBJ geometry",
  );
  await page.locator("#wireframe-mode").selectOption("lines");
  await page.locator("#wireframe-mode").selectOption("overlay");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sceneSnapshot.objects.every((o) => o.overlayCount === 1),
      ),
    )
    .toBe(true);
  await page.locator("#wireframe-mode").selectOption("hidden");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sceneSnapshot.objects.every(
          (o) =>
            !o.wireframe &&
            o.overlay &&
            o.occluder &&
            !o.colorWrite &&
            o.occluderGeometry === o.geometryId,
        ),
      ),
    )
    .toBe(true);
  assert.equal(
    (await exported())["model.obj"],
    wireframeBaseline["model.obj"],
    "Hidden-line display never changes OBJ geometry",
  );
  await page.locator("#wireframe-mode").selectOption("overlay");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sceneSnapshot.objects.every((o) => !o.occluder && o.colorWrite),
      ),
    )
    .toBe(true);
  await page.locator("#wireframe-mode").selectOption("lines");
  await page.locator("#wireframe").uncheck();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sceneSnapshot.objects.every((o) => !o.wireframe),
      ),
    )
    .toBe(true);
  const initialNames = await page.locator(".object-row span").allTextContents();
  assert.equal(
    new Set(initialNames).size,
    initialNames.length,
    "Imported object names are unique",
  );
  const renamedObject = "Custom sculpture";
  await page.locator("#object-name").fill(renamedObject);
  await page.locator("#object-name").dispatchEvent("change");
  await expect(page.locator("#selected-name")).toHaveText(renamedObject);
  assert.match((await exported())["model.obj"], /o Custom_sculpture/);
  await page.locator("#undo").click();
  await expect(page.locator("#selected-name")).toHaveText(initialNames[0]);
  await page.locator("#redo").click();
  await expect(page.locator("#selected-name")).toHaveText(renamedObject);
  await page.locator("#undo").click();
  await page.locator('[data-visibility="0"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__sceneSnapshot.objects[0].visible))
    .toBe(false);
  const hiddenExport = await exported();
  assert.equal(
    (hiddenExport["model.obj"].match(/^o /gm) || []).length,
    1,
    "Hidden object is excluded from export",
  );
  await page.locator("#undo").click();
  await expect
    .poll(() => page.evaluate(() => window.__sceneSnapshot.objects[0].visible))
    .toBe(true);
  await page.locator("#redo").click();
  await expect
    .poll(() => page.evaluate(() => window.__sceneSnapshot.objects[0].visible))
    .toBe(false);
  await page.locator("#undo").click();
  const first = await exported();
  assert.match(first["model.obj"], /o Ring/);
  assert.match(first["model.obj"], /o Arrow/);
  assert.match(first["model.obj"], /mtllib model\.mtl/);
  assert.equal((first["model.mtl"].match(/newmtl /g) || []).length, 2);
  const beforeUV = await page.evaluate(() =>
    window.__sceneSnapshot.objects.map((o) => o.geometryId),
  );
  await page.locator("#uvScaleX").fill("2");
  const changed = await exported();
  assert.deepEqual(
    await page.evaluate(() =>
      window.__sceneSnapshot.objects.map((o) => o.geometryId),
    ),
    beforeUV,
    "UV edits reuse mesh geometry",
  );
  const lines = (s, prefix) =>
    s.split("\n").filter((line) => line.startsWith(prefix));
  assert.notDeepEqual(
    lines(first["model.obj"], "vt "),
    lines(changed["model.obj"], "vt "),
  );
  assert.deepEqual(
    lines(first["model.obj"], "v "),
    lines(changed["model.obj"], "v "),
  );
  await page.locator('[data-object="1"]').click();
  const beforeDepth = await page.evaluate(() => window.__sceneSnapshot);
  await page.locator("#depth").fill("40");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects[1].depth,
    )
    .not.toBe(beforeDepth.objects[1].depth);
  const afterDepth = await page.evaluate(() => window.__sceneSnapshot);
  assert.deepEqual(
    afterDepth.objects[0],
    beforeDepth.objects[0],
    "Changing selected depth must keep the other mesh at its actual world position",
  );
  assert.deepEqual(
    afterDepth.camera,
    beforeDepth.camera,
    "Editing depth preserves the camera",
  );
  assert.deepEqual(
    afterDepth.target,
    beforeDepth.target,
    "Editing depth preserves orbit target",
  );
  const beforeBurst = await page.evaluate(() => window.__geometryBuilds);
  await page.locator("#depth").evaluate((el) => {
    for (let i = 0; i < 20; i++) {
      el.value = String(41 + i);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects[1].depth,
    )
    .toBe(60);
  assert.equal(
    (await page.evaluate(() => window.__geometryBuilds)) - beforeBurst,
    1,
    "A burst of parameter input events builds selected mesh once",
  );
  await page.locator("#depth").fill("40");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects[1].depth,
    )
    .toBe(40);
  await page.locator('[data-object="0"]').click();
  await expect(page.locator("#depth")).toHaveValue("24");
  await page.locator('[data-object="1"]').click();
  await expect(page.locator("#depth")).toHaveValue("40");
  await expect(page.locator('[data-range="bevelSize"]')).toHaveAttribute(
    "max",
    "20",
  );
  await page.locator('[data-range="bevelSize"]').evaluate((el) => {
    el.value = el.max;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#bevelSize")).toHaveValue("20");
  await expect(page.locator("#geometry-status")).toContainText(
    /奥行方向：20(?:\.0+)? \//,
  );
  await page.locator("#bevelSize").fill("3");
  await expect(page.locator("#geometry-status")).toContainText(
    "奥行方向：3.00",
  );
  const initialTransforms = await page.evaluate(() => window.__sceneSnapshot);
  await page.locator("#position-x").fill("12");
  await page.locator("#rotation-z").fill("35");
  await page.locator("#scale-x").fill("1.5");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects[1].matrix,
    )
    .not.toEqual(initialTransforms.objects[1].matrix);
  const transformedMesh = await page.evaluate(() => window.__sceneSnapshot);
  assert.deepEqual(
    transformedMesh.objects[0],
    initialTransforms.objects[0],
    "Transform only affects selected object",
  );
  const transformedExport = await exported();
  await page.locator("#depth").fill("42");
  await expect(page.locator("#position-x")).toHaveValue("12");
  await expect(page.locator("#rotation-z")).toHaveValue("35");
  await expect(page.locator("#scale-x")).toHaveValue("1.5");
  await page.locator("#depth").fill("40");
  const rebuiltExport = await exported();
  assert.deepEqual(
    lines(transformedExport["model.obj"], "v "),
    lines(rebuiltExport["model.obj"], "v "),
    "Rebuilding preserves transforms and OBJ coordinates",
  );
  await page.locator('[data-object="0"]').click();
  await expect(page.locator("#position-x")).toHaveValue("0");
  await page.locator('[data-object="1"]').click();
  await expect(page.locator("#position-x")).toHaveValue("12");
  for (const mode of ["rotate", "scale", "translate"]) {
    await page.locator(`#transform-${mode}`).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__sceneSnapshot)).gizmo.mode,
      )
      .toBe(mode);
  }
  await page.locator("#transform-reset").click();
  await expect(page.locator("#position-x")).toHaveValue("0");
  await expect(page.locator("#rotation-z")).toHaveValue("0");
  await expect(page.locator("#scale-x")).toHaveValue("1");
  const beforeGizmo = await page.evaluate(() => window.__sceneSnapshot);
  let gizmoDragged = false;
  for (const handle of beforeGizmo.gizmo.handles) {
    await page.mouse.move(handle.x, handle.y);
    const hover = await page.evaluate(() => window.__sceneSnapshot.gizmo.axis);
    if (hover !== "X") continue;
    await page.mouse.down();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__sceneSnapshot)).orbitEnabled,
      )
      .toBe(false);
    await page.mouse.move(handle.x + 35, handle.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__sceneSnapshot)).orbitEnabled,
      )
      .toBe(true);
    gizmoDragged = true;
    break;
  }
  assert(gizmoDragged, "An actual X manipulator drag must be tested");
  const afterGizmo = await page.evaluate(() => window.__sceneSnapshot);
  assert.notDeepEqual(
    afterGizmo.objects[1].matrix,
    beforeGizmo.objects[1].matrix,
    "Dragging X manipulator moves selected object",
  );
  assert.deepEqual(
    afterGizmo.objects[0],
    beforeGizmo.objects[0],
    "Manipulator preserves unselected object",
  );
  await page.locator("#transform-reset").click();
  const beforeColor = await page.evaluate(() =>
    window.__sceneSnapshot.objects.map((o) => o.geometryId),
  );
  await page.locator("#color").evaluate((el) => {
    el.value = "#ff0000";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const colored = await exported();
  assert.deepEqual(
    await page.evaluate(() =>
      window.__sceneSnapshot.objects.map((o) => o.geometryId),
    ),
    beforeColor,
    "Color changes reuse mesh geometry",
  );
  assert.match(colored["model.mtl"], /newmtl material_2\nKd 1 0 0/);
  const curve = page.locator(".curve-display svg");
  assert(
    (await page.locator("#curve").count()) === 0,
    "Scalar curve shape control is removed",
  );
  const normalCurveBox = await curve.boundingBox();
  assert(
    normalCurveBox.height >= 150,
    "Curve editor offers a larger default editing area",
  );
  await page.locator("#curve-expand").click();
  await expect
    .poll(async () => (await curve.boundingBox()).width)
    .toBeGreaterThan(normalCurveBox.width);
  await page.locator(".curve-dialog-heading button").click();
  await page.locator("circle[data-curve-point]").nth(1).click();
  await curve.focus();
  await page.keyboard.press("ArrowUp");
  const customized = await exported();
  assert.notDeepEqual(
    lines(colored["model.obj"], "v "),
    lines(customized["model.obj"], "v "),
  );
  const points = page.locator("circle[data-curve-point]");
  await expect(points).toHaveCount(3);
  const curveBox = await curve.boundingBox();
  await curve.click({
    position: { x: curveBox.width * 0.7, y: curveBox.height * 0.35 },
  });
  await expect(points).toHaveCount(4);
  const added = await exported();
  assert.notDeepEqual(
    lines(added["model.obj"], "v "),
    lines(customized["model.obj"], "v "),
    "Adding a bevel vertex changes exported geometry",
  );
  const selectedPoint = page.locator("circle[data-curve-point].selected");
  await selectedPoint.scrollIntoViewIfNeeded();
  const pointBox = await selectedPoint.boundingBox();
  await page.mouse.move(
    pointBox.x + pointBox.width / 2,
    pointBox.y + pointBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    pointBox.x + pointBox.width / 2 + 8,
    pointBox.y + pointBox.height / 2 - 5,
    { steps: 3 },
  );
  await page.mouse.up();
  const dragged = await exported();
  assert.notDeepEqual(
    lines(dragged["model.obj"], "v "),
    lines(added["model.obj"], "v "),
    "Dragging an added bevel vertex changes geometry",
  );
  await page.locator("#curve-point-mode").selectOption("bezier");
  await expect(page.locator("[data-curve-handle]")).toHaveCount(2);
  await expect(page.locator("#curve-handle-mode")).toHaveValue("free");
  const oppositeBefore = await page
    .locator('[data-curve-handle="out"]')
    .evaluate((e) => [e.getAttribute("cx"), e.getAttribute("cy")]);
  const beforeHandle = await exported();
  await page.locator('[data-curve-handle="in"]').scrollIntoViewIfNeeded();
  const handleBox = await page
    .locator('[data-curve-handle="in"]')
    .boundingBox();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2 + 5,
    { steps: 4 },
  );
  await page.mouse.up();
  const afterHandle = await exported();
  assert.deepEqual(
    await page
      .locator('[data-curve-handle="out"]')
      .evaluate((e) => [e.getAttribute("cx"), e.getAttribute("cy")]),
    oppositeBefore,
    "Independent drag leaves opposite handle unchanged",
  );
  assert.notDeepEqual(
    lines(beforeHandle["model.obj"], "v "),
    lines(afterHandle["model.obj"], "v "),
    "Dragging a Bezier handle changes actual exported geometry",
  );
  await page.locator("#curve-handle-mode").selectOption("aligned");
  const alignedHandle = await page
    .locator('[data-curve-handle="in"]')
    .boundingBox();
  await page.mouse.move(
    alignedHandle.x + alignedHandle.width / 2,
    alignedHandle.y + alignedHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    alignedHandle.x + alignedHandle.width / 2,
    alignedHandle.y + alignedHandle.height / 2 + 3,
    { steps: 4 },
  );
  await page.mouse.up();
  const tangent = await page.evaluate(() => {
    const p = document.querySelector("circle[data-curve-point].selected");
    const a = document.querySelector('[data-curve-handle="in"]');
    const b = document.querySelector('[data-curve-handle="out"]');
    const v = (e) => [
      Number(e.getAttribute("cx")) - Number(p.getAttribute("cx")),
      Number(e.getAttribute("cy")) - Number(p.getAttribute("cy")),
    ];
    return [v(a), v(b)];
  });
  assert(
    Math.abs(tangent[0][0] * tangent[1][1] - tangent[0][1] * tangent[1][0]) <
      0.001,
    "Aligned handles stay on one tangent after actual drag",
  );
  await page.locator("#curve-handle-mode").selectOption("free");
  await page.locator("#curve-point-mode").selectOption("linear");
  await expect(page.locator("[data-curve-handle]")).toHaveCount(0);
  await page.locator("#curve-point-mode").selectOption("bezier");
  await exported();
  const beforeInvalidProfile = await page.evaluate(() =>
    window.__sceneSnapshot.objects.map((o) => o.geometryId),
  );
  const invalidHandle = await page
    .locator('[data-curve-handle="in"]')
    .boundingBox();
  await page.mouse.move(
    invalidHandle.x + invalidHandle.width / 2,
    invalidHandle.y + invalidHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    invalidHandle.x + invalidHandle.width / 2,
    invalidHandle.y + invalidHandle.height / 2 - 80,
    { steps: 1 },
  );
  await page.mouse.up();
  await expect(page.locator("#message")).toHaveClass(/error/);
  await expect(page.locator("#message")).toContainText("戻らない");
  assert.deepEqual(
    await page.evaluate(() =>
      window.__sceneSnapshot.objects.map((o) => o.geometryId),
    ),
    beforeInvalidProfile,
    "Invalid continued profile preserves previously displayed geometry",
  );
  await page.locator("#curve-point-mode").selectOption("linear");
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  const storedCurve = await page.locator("#curve-path").getAttribute("d");
  await page.locator('[data-object="0"]').click();
  await expect(points).toHaveCount(3);
  await page.locator('[data-object="1"]').click();
  await expect(points).toHaveCount(4);
  assert.equal(
    await page.locator("#curve-path").getAttribute("d"),
    storedCurve,
    "Each object retains its own added profile vertices",
  );
  await points.nth(2).click();
  await curve.focus();
  await page.keyboard.press("Delete");
  await expect(points).toHaveCount(3);
  const addBox = await curve.boundingBox();
  const midpoint = await points.evaluateAll(nodes => {
    const values = nodes.map(n => [Number(n.getAttribute("cx")),Number(n.getAttribute("cy"))]);
    let best = 0;
    for (let i=1;i<values.length-1;i++) if (values[i+1][0]-values[i][0]>values[best+1][0]-values[best][0]) best=i;
    return [(values[best][0]+values[best+1][0])/2,(values[best][1]+values[best+1][1])/2];
  });
  await curve.click({position:{x:addBox.width*midpoint[0]/480,y:addBox.height*midpoint[1]/280}});
  await expect(points).toHaveCount(4);
  await curve.focus();
  await page.keyboard.press("Delete");
  await expect(points).toHaveCount(3);
  const exactBox = await curve.boundingBox();
  await curve.click({
    position: {
      x: (exactBox.width * (30 + 0.7 * 420)) / 480,
      y: (exactBox.height * (245 - 0.1 * 215)) / 280,
    },
  });
  await expect(points).toHaveCount(4);
  const exactAdded = page.locator("circle[data-curve-point].selected");
  assert(
    Math.abs(Number(await exactAdded.getAttribute("cx")) - (30 + 0.7 * 420)) <
      1.5,
    "Click preserves requested X",
  );
  assert(
    Math.abs(Number(await exactAdded.getAttribute("cy")) - (245 - 0.1 * 215)) <
      1.5,
    "Click preserves Y below prior vertex",
  );
  await page.keyboard.press("Delete");
  await expect(points).toHaveCount(3);
  const beforeAppend = await page.evaluate(() => window.__sceneSnapshot);
  const oldProfile = await page.locator("#curve-path").getAttribute("d");
  await page.locator("#position-x").fill("7");
  await page.locator("#file").setInputFiles({
    name: "rectangle.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="Box" d="M0 0H100V100H0Z"/></svg>',
    ),
  });
  await expect(page.locator("#object-count")).toHaveText("3");
  const afterAppend = await page.evaluate(() => window.__sceneSnapshot);
  assert.deepEqual(
    afterAppend.objects[0],
    beforeAppend.objects[0],
    "Import preserves prior geometry and world position",
  );
  assert.deepEqual(
    afterAppend.camera,
    beforeAppend.camera,
    "Appending preserves camera",
  );
  assert.deepEqual(
    afterAppend.target,
    beforeAppend.target,
    "Appending preserves orbit origin",
  );
  await page.locator('[data-object="1"]').click();
  await expect(page.locator("#position-x")).toHaveValue("7");
  await expect(page.locator("#color")).toHaveValue("#ff0000");
  assert.equal(await page.locator("#curve-path").getAttribute("d"), oldProfile);
  await page.locator('[data-object="2"]').click();
  await expect(page.locator("#position-x")).toHaveValue("0");
  await page.locator("#hollow").check();
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  const hollow = await exported();
  assert.match(hollow["model.obj"], /o Box/);
  assert(!/NaN|Infinity/.test(hollow["model.obj"]));
  await page.locator("#tab-uv").click();
  await expect(page.locator("#uv-canvas")).toBeVisible();
  await page.locator("#uv-edit-mode").check();
  await page.locator("#uv-canvas").scrollIntoViewIfNeeded();
  const point = await page.evaluate(async () => {
    const { parseSvg, buildMesh } = await import("/src/geometry.js");
    const shape = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="Box" d="M0 0H100V100H0Z"/></svg>',
    ).objects[0].shape;
    const geometry = buildMesh(shape, {
      depth: 24,
      bevelSize: 3,
      bevelSegments: 5,
      bevelFullWidth: true,
      bevelContinue: true,
      bevelWidth: 3,
      curvePoints: [
        { x: 0, y: 0, mode: "linear" },
        { x: 0.5, y: 0.5, mode: "linear" },
        { x: 1, y: 1, mode: "linear" },
      ],
      sharpCorners: true,
      hollow: true,
      wallThickness: 4,
    });
    const uv = geometry.getAttribute("uv"),
      canvas = document.getElementById("uv-canvas");
    const rect = canvas.getBoundingClientRect(),
      size = Math.min(canvas.width - 45, canvas.height - 35);
    const x = (canvas.width - size) / 2 + uv.getX(0) * size;
    const y = canvas.height - 18 - uv.getY(0) * size;
    geometry.dispose();
    return { x: rect.left + x, y: rect.top + y };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 12, point.y - 8, { steps: 3 });
  await page.mouse.up();
  const edited = await exported();
  assert.notDeepEqual(
    lines(edited["model.obj"], "vt "),
    lines(hollow["model.obj"], "vt "),
    "Dragging a UV vertex modifies exported coordinates",
  );
  assert.deepEqual(
    lines(edited["model.obj"], "v "),
    lines(hollow["model.obj"], "v "),
  );
  await page.locator("#uv-clear").click();
  const cleared = await exported();
  assert.deepEqual(
    lines(cleared["model.obj"], "vt "),
    lines(hollow["model.obj"], "vt "),
  );
  await page.locator("#tab-3d").click();
  await expect(page.locator("#viewport canvas")).toBeVisible();
  await page.locator("#file").setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10L0 10L10 0Z"/></svg>',
    ),
  });
  await expect(page.locator("#message")).toHaveClass(/error/);
  await expect(page.locator("#object-count")).toHaveText("3");
  await expect(page.locator("#selected-name")).toHaveText(/Box \d+/);
  const orbitBox = await page.locator("#viewport canvas").boundingBox();
  await page.mouse.move(orbitBox.x + 30, orbitBox.y + 40);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(orbitBox.x + 90, orbitBox.y + 40, { steps: 5 });
  await page.mouse.up({ button: "right" });
  const cameraSamples = await page.evaluate(async () => {
    const samples = [window.__sceneSnapshot.camera];
    for (let group = 0; group < 3; group++) {
      for (let frame = 0; frame < 10; frame++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(window.__sceneSnapshot.camera);
    }
    return samples;
  });
  const matrixDistance = (a, b) =>
    Math.hypot(...a.map((value, i) => value - b[i]));
  const initialDrift = matrixDistance(cameraSamples[0], cameraSamples[1]);
  const residualDrift = matrixDistance(cameraSamples[2], cameraSamples[3]);
  assert(
    residualDrift < Math.max(1e-6, initialDrift * 0.02),
    "Camera inertia settles within 30 frames after an actual orbit pan",
  );
  const densePath =
    Array.from({ length: 400 }, (_, i) => {
      const a = (i * Math.PI * 2) / 400;
      return `${i ? "L" : "M"}${100 + 100 * Math.cos(a)} ${100 + 100 * Math.sin(a)}`;
    }).join(" ") + "Z";
  await page.locator("#file").setInputFiles({
    name: "dense-curve.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><path id="Dense" d="${densePath}"/></svg>`,
    ),
  });
  await expect(page.locator("#object-count")).toHaveText("4");
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  await expect(page.locator("#reduction-info")).toContainText("400");
  const unreduced = await exported();
  await page.locator("#reductionTolerance").fill("0.5");
  const reduced = await exported();
  assert(
    lines(reduced["model.obj"].split(/o Dense_\d+\n/)[1], "v ").length <
      lines(unreduced["model.obj"].split(/o Dense_\d+\n/)[1], "v ").length / 2,
    "Reduction parameter reduces exported mesh complexity",
  );
  assert(!/NaN|Infinity/.test(reduced["model.obj"]));
  await expect(page.locator("#geometry-status")).toContainText("奥行方向");
  await page.locator("#hollow").check();
  await page.locator("#wallThickness").fill("150");
  const narrow = await exported();
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  assert(!/NaN|Infinity/.test(narrow["model.obj"]));
  await expect(page.locator("#geometry-status")).toContainText("壁厚");
  const hugePath =
    Array.from({ length: 3200 }, (_, i) => {
      const a = (i * Math.PI * 2) / 3200;
      return `${i ? "L" : "M"}${100 + 100 * Math.cos(a)} ${100 + 100 * Math.sin(a)}`;
    }).join(" ") + "Z";
  const beforeOversized = await page.locator("#object-count").textContent();
  const beforeOversizedName = await page.locator("#selected-name").textContent();
  page.once("dialog",dialog=>{assert.equal(dialog.type(),"confirm");assert.match(dialog.message(),/3,000/);dialog.dismiss();});
  await page.locator("#file").setInputFiles({
    name: "3200-points.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><path id="Huge" d="${hugePath}"/></svg>`,
    ),
  });
  await expect(page.locator("#message")).toContainText("キャンセル");
  assert.equal(await page.locator("#object-count").textContent(),beforeOversized);
  assert.equal(await page.locator("#selected-name").textContent(),beforeOversizedName);
  page.once("dialog",dialog=>dialog.accept());
  await page.locator("#file").setInputFiles({
    name: "3200-points.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><path id="Huge" d="${hugePath}"/></svg>`,
    ),
  });
  await expect(page.locator("#selected-name")).toHaveText(/Huge \d+/, { timeout: 15000 });
  await expect(page.locator("#object-count")).toHaveText("5");
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  assert.equal(Number(await page.locator("#reductionTolerance").inputValue()),0,"approved reduction changes the source path");
  const hugeImport = (await projectData()).state.objects.at(-1).importReduction;
  assert.equal(hugeImport.originalCount,3200);
  assert(hugeImport.reducedCount<=3000);
  await page.locator("#file").setInputFiles({
    name: "tiny.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="Tiny" d="M0 0H2V2H0Z"/></svg>',
    ),
  });
  await expect(page.locator("#selected-name")).toHaveText(/Tiny \d+/);
  assert(
    Math.abs(Number(await page.locator("#depth").inputValue()) - 0.6) < 1e-8,
  );
  assert(
    Math.abs(Number(await page.locator("#bevelSize").inputValue()) - 0.08) <
      1e-8,
    `tiny bevel initial value: ${await page.locator("#bevelSize").inputValue()}`,
  );
  assert(
    Math.abs(Number(await page.locator("#wallThickness").inputValue()) - 0.3) <
      1e-8,
  );
  await page.locator("#hollow").check();
  const tiny = await exported();
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  assert(!/NaN|Infinity/.test(tiny["model.obj"]));
  const beforeRepeated = await page.evaluate(
    () => window.__sceneSnapshot.objects,
  );
  const repeatedFile = {
    name: "tiny.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="Tiny" d="M0 0H2V2H0Z"/></svg>',
    ),
  };
  await page.locator("#file").setInputFiles(repeatedFile);
  await expect(page.locator("#object-count")).toHaveText("7");
  await page.locator("#file").setInputFiles(repeatedFile);
  await expect(page.locator("#object-count")).toHaveText("8");
  const afterRepeated = await page.evaluate(
    () => window.__sceneSnapshot.objects,
  );
  assert.deepEqual(
    afterRepeated.slice(0, 6),
    beforeRepeated,
    "Repeated same-name path IDs preserve earlier objects",
  );
  const repeatedExport = await exported();
  assert.equal((repeatedExport["model.mtl"].match(/newmtl /g) || []).length, 8);
  // Regression: axial slider at its maximum plus lateral slider at exactly
  // its displayed maximum previously disabled the hollow-wall protection.
  await page.locator("#hollow").check();
  await page.locator("#bevelSize").fill("0.3");
  const wallWidthMax = Number(
    await page.locator('[data-range="bevelWidth"]').getAttribute("max"),
  );
  await page.locator("#bevelWidth").fill(String(wallWidthMax));
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
          .centralWallDepth,
    )
    .toBeGreaterThanOrEqual(0.0119);
  await expect.poll(async () => (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1).effectiveBevelDepth).toBeGreaterThan(0.29);
  const protectedHollow = await exported();
  assert(!/NaN|Infinity/.test(protectedHollow["model.obj"]));
  await page.locator("#file").setInputFiles({
    name: "ridge-L.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="Ridge-L" d="M0 0H36V140H130V176H0Z"/></svg>',
    ),
  });
  await expect(page.locator("#selected-name")).toHaveText(/Ridge-L \d+/);
  await page.locator("#depth").fill("24");
  await expect(page.locator('[data-range="bevelSize"]')).toHaveAttribute(
    "max",
    "12",
  );
  await page.locator("#bevelSize").fill("12");
  await page.locator("#bevelWidth").fill("18");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
          .effectiveBevel,
    )
    .toBeGreaterThan(17.99);
  assert.equal(
    (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
      .effectiveBevelDepth,
    12,
  );
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  const ridgeExport = await exported();
  assert.match(ridgeExport["model.obj"], /o Ridge-L/);
  assert(!/NaN|Infinity/.test(ridgeExport["model.obj"]));
  await page.locator("#tab-3d").click();
  await page.screenshot({ path: join(work, "ridge-L-browser.png") });
  // Independent hollow profiles are editable without changing the opposite curve.
  await page.locator("#hollow").check();
  await page.locator("#wallThickness").fill("8");
  await page.locator("#bevelWidth").fill("2");
  await page.locator("#bevelSize").fill("8");
  await expect(page.locator("#curve-side")).toHaveValue("outer");
  const outerBefore = await page.locator("circle[data-curve-point]").evaluateAll(es => es.map(e => [e.getAttribute("cx"), e.getAttribute("cy")]));
  await page.locator("#curve-side").selectOption("inner");
  await page.locator("circle[data-curve-point]").nth(1).click();
  await expect(page.locator("#curve-point-mode")).toHaveValue("bezier");
  await expect(page.locator("#curve-handle-mode")).toHaveValue("aligned");
  const beforeInnerEdit = await exported();
  await page.locator("#bevel-curve-settings svg").focus();
  await page.keyboard.press("ArrowUp");
  const afterInnerEdit = await exported();
  assert.notEqual(afterInnerEdit["model.obj"], beforeInnerEdit["model.obj"], "inner curve edits affect exported mesh");
  const editedInner = await page.locator("circle[data-curve-point]").evaluateAll(es => es.map(e => [e.getAttribute("cx"), e.getAttribute("cy")]));
  await page.locator("#curve-side").selectOption("outer");
  assert.deepEqual(await page.locator("circle[data-curve-point]").evaluateAll(es => es.map(e => [e.getAttribute("cx"), e.getAttribute("cy")])), outerBefore, "editing inner curve preserves outer curve");
  await page.locator("#curve-side").selectOption("inner");
  assert.deepEqual(await page.locator("circle[data-curve-point]").evaluateAll(es => es.map(e => [e.getAttribute("cx"), e.getAttribute("cy")])), editedInner, "switching curves retains independent edits");
  await page.locator("#curve-side").selectOption("outer");
  // Regression: many fine, unreduced edges must not suppress an otherwise
  // modest bevel on a substantial hollow rim.
  const fineOutline = ["M0 0", "L100 0", "L100 100", "L0 100", "L0 51"];
  for (let index = 1; index <= 50; index++) {
    const t = index / 50;
    fineOutline.push(`L${-0.1 * Math.sin(Math.PI * t) ** 2} ${51 - t}`);
  }
  fineOutline.push("L0 0Z");
  await page.locator("#file").setInputFiles({
    name: "fine-hollow.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><path id="Fine-hollow" d="${fineOutline.join(" ")}"/></svg>`,
    ),
  });
  await expect(page.locator("#selected-name")).toHaveText(/Fine-hollow/);
  await page.locator("#depth").fill("20");
  await page.locator("#hollow").check();
  await page.locator("#wallThickness").fill("3");
  await page.locator("#bevelSize").fill("10");
  await page.locator("#bevelWidth").fill("0.4");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
          .effectiveBevel,
    )
    .toBeGreaterThan(0.399);
  const fineBevelSmall = await exported();
  await page.locator("#bevelWidth").fill("1");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
          .effectiveBevel,
    )
    .toBeGreaterThan(0.99);
  const fineBevelLarge = await exported();
  assert.notEqual(
    fineBevelLarge["model.obj"],
    fineBevelSmall["model.obj"],
    "Changing a hollow bevel width updates actual exported geometry",
  );
  assert(!/NaN|Infinity/.test(fineBevelLarge["model.obj"]));
  assert.ok(
    (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
      .effectiveWallThickness > 2.99,
  );
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  // The same unreduced source must also bevel when automatic hollowing is off.
  // Compare the exported selected object's real sloping faces, not only UI values.
  await page.locator("#hollow").uncheck();
  const solidSlopeArea = (obj) => {
    const vertices = [];
    let selected = false;
    let area = 0;
    for (const line of obj.split("\n")) {
      if (line.startsWith("v "))
        vertices.push(line.slice(2).trim().split(/\s+/).map(Number));
      if (line.startsWith("o ")) selected = line.includes("Fine-hollow");
      if (!selected || !line.startsWith("f ")) continue;
      const [a, b, c] = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((part) => vertices[Number(part.split("/")[0]) - 1]);
      const z = [a[2], b[2], c[2]];
      if (Math.max(...z) > 10.00001 || Math.max(...z) - Math.min(...z) < 1e-6)
        continue;
      area +=
        Math.abs(
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
        ) / 2;
    }
    return area;
  };
  for (const continued of [false, true]) {
    await page.locator("#bevelContinue").setChecked(continued);
    const areas = [];
    for (const width of [1, 3]) {
      await page.locator("#bevelWidth").fill(String(width));
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.__sceneSnapshot)).objects.at(-1)
              .effectiveBevel,
        )
        .toBeGreaterThan(width * 0.99);
      const result = await exported();
      areas.push(solidSlopeArea(result["model.obj"]));
      assert(areas.at(-1) > width * 380, "Solid bevel has actual sloped faces");
    }
    assert(
      areas[1] > areas[0] * 2,
      "A wider solid bevel changes the exported slope area",
    );
  }
  // Use a fresh, small project for persistence/duplication and filesystem API tests.
  await page.reload();
  await page.evaluate(() => { window.showDirectoryPicker = undefined; window.showSaveFilePicker = undefined; });
  await page.locator("#file").setInputFiles({name: "state.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H40V40H0Z"/><path d="M60 0H90V30H60Z"/></svg>')});
  await expect(page.locator("#object-count")).toHaveText("2");
  async function editField(id, value) {
    await page.locator(`#${id}`).fill(String(value));
    await page.locator(`#${id}`).dispatchEvent("input");
    await page.locator(`#${id}`).dispatchEvent("change");
  }
  async function projectData() {
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#project-save").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "project.pathform");
    const path = join(work, `project-${iteration++}.pathform`);
    await download.saveAs(path);
    return JSON.parse(await readFile(path, "utf8"));
  }
  await editField("object-name", "Saved sculpture");
  await editField("position-x", 7);
  await editField("rotation-y", 24);
  await editField("scale-z", 1.5);
  await editField("uvOffsetX", 0.17);
  await editField("color", "#aa7733");
  await page.locator('[data-visibility="1"]').click();
  await page.locator("#wireframe").check();
  await page.locator("#wireframe-mode").selectOption("hidden");
  const saved = await projectData();
  const savedExport = await exported();
  const originalGeometry = (await page.evaluate(() => window.__sceneSnapshot)).objects[0].geometryId;
  await page.locator("#duplicate").click();
  await expect(page.locator("#object-count")).toHaveText("3");
  const duplicated = await projectData();
  assert.equal(new Set(duplicated.state.objects.map(o => o.id)).size, 3);
  assert.equal(new Set(duplicated.state.objects.map(o => o.name)).size, 3);
  const copy = duplicated.state.objects[2], original = duplicated.state.objects[0];
  for (const key of ["shape", "settings", "transform", "visible", "color"]) {
    const normalize = value => JSON.parse(JSON.stringify(value, (k,v) => k === "uuid" ? undefined : v));
    assert.deepEqual(normalize(copy[key]), normalize(original[key]), `Duplicate preserves ${key}`);
  }
  assert.notEqual((await page.evaluate(() => window.__sceneSnapshot)).objects[2].geometryId, originalGeometry);
  await editField("depth", 16);
  const changedCopy = await projectData();
  assert.equal(changedCopy.state.objects[0].settings.depth, original.settings.depth, "Duplicated settings are independent");
  await page.locator("#undo").click();
  await page.locator("#undo").click();
  await expect(page.locator("#object-count")).toHaveText("2");
  await page.locator("#redo").click();
  await expect(page.locator("#object-count")).toHaveText("3");
  await editField("object-name", "Changed copy");
  await page.locator("#fit").click();
  await page.locator("#project-file").setInputFiles({name:"saved.pathform", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(saved))});
  await expect(page.locator("#object-count")).toHaveText("2");
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  const restored = await projectData();
  assert.deepEqual(restored.state.objects, saved.state.objects, "Project reload preserves source paths, settings, UV, names, material, visibility and transforms");
  assert.deepEqual(restored.state.view, saved.state.view, "Project reload preserves camera and display settings");
  assert.equal(restored.state.selected, saved.state.selected);
  assert.deepEqual(await exported(), savedExport, "Roundtrip preserves actual exported geometry and UVs");
  await page.locator("#undo").click();
  await expect(page.locator("#object-count")).toHaveText("3");
  await page.locator("#redo").click();
  await expect(page.locator("#object-count")).toHaveText("2");
  await page.locator("#project-file").setInputFiles({name:"invalid.pathform", mimeType:"application/json", buffer:Buffer.from('{"format":"Wrong","version":1}')});
  await expect(page.locator("#message")).toHaveClass(/error/);
  const afterInvalid = await projectData();
  assert.deepEqual(afterInvalid.state.objects, saved.state.objects, "Invalid project keeps current objects intact");
  assert.deepEqual(await exported(), savedExport);
  // Directory saving is exercised through a real button click and writable handles.
  await page.evaluate(() => {
    window.__savedFiles = {}; window.__pickerCalls = 0;
    window.showDirectoryPicker = async options => {
      window.__pickerCalls++; window.__pickerOptions = options;
      return {getFileHandle: async (name, options) => {
        if (!options?.create) throw new DOMException("Missing", "NotFoundError");
        return {createWritable: async () => ({write: async text => { window.__savedFiles[name] = text instanceof Blob ? await text.text() : String(text); }, close: async () => {}, abort: async () => {}})};
      }};
    };
  });
  await page.locator("#export-folder").check();
  await page.locator("#export").click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__savedFiles).length)).toBe(2);
  assert.deepEqual(await page.evaluate(() => window.__savedFiles), savedExport);
  assert.equal(await page.evaluate(() => window.__pickerCalls), 1);
  assert.equal(await page.evaluate(() => window.__pickerOptions.mode), "readwrite");
  await page.evaluate(() => { window.showDirectoryPicker = async () => { throw new DOMException("Cancelled", "AbortError"); }; });
  const cancelledDownloads = [];
  const cancelListener = download => cancelledDownloads.push(download);
  page.on("download", cancelListener);
  await page.locator("#export").click();
  await page.waitForTimeout(100);
  page.off("download", cancelListener);
  assert.equal(cancelledDownloads.length, 0, "Cancelled directory picker does not download unexpectedly");
  assert.deepEqual((await projectData()).state.objects, saved.state.objects, "Cancelling export preserves project data");
  await page.evaluate(() => { window.showDirectoryPicker = undefined; });
  assert.deepEqual(await exported(), savedExport, "Unsupported directory API falls back to same OBJ and MTL downloads");
  await page.locator("#export-folder").uncheck();
  await expect.poll(() => page.locator("#hollow-settings").evaluate(el => el.previousElementSibling.id)).toBe("bevel-settings");
  const orderBefore = await projectData();
  const orderMeshes = await page.evaluate(() => window.__sceneSnapshot.objects.map(o => o.geometryId));
  await page.locator("#reorder-down").click();
  const orderAfter = await projectData();
  assert.deepEqual(orderAfter.state.objects.map(o => o.id), [...orderBefore.state.objects.map(o => o.id)].reverse());
  assert.equal(orderAfter.state.objects[1].name, orderBefore.state.objects[0].name);
  assert.deepEqual(await page.evaluate(() => window.__sceneSnapshot.objects.map(o => o.geometryId)), [...orderMeshes].reverse(), "Reorder preserves mesh instances");
  await page.locator("#undo").click();
  assert.deepEqual((await projectData()).state.objects.map(o => o.id), orderBefore.state.objects.map(o => o.id));
  await page.locator("#redo").click();
  assert.deepEqual((await projectData()).state.objects.map(o => o.id), orderAfter.state.objects.map(o => o.id));
  const reducePath = Array.from({length:120},(_,i)=>{
    const a=i*Math.PI*2/120;
    return `${i ? "L" : "M"}${40+40*Math.cos(a)} ${40+40*Math.sin(a)}`;
  }).join(" ")+" Z";
  await page.locator("#file").setInputFiles({name:"source-reduction.svg",mimeType:"image/svg+xml",buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${reducePath}"/></svg>`)});
  await expect(page.locator("#object-count")).toHaveText("3");
  await editField("reductionTolerance",0.5);
  const sourceBefore = (await projectData()).state.objects[2];
  const previewExport = await exported();
  await page.locator("#apply-reduction").click();
  const sourceAfter = (await projectData()).state.objects[2];
  assert(sourceAfter.shape.curves.length < sourceBefore.shape.curves.length, "Apply reduction changes the actual saved source path");
  assert.notEqual(sourceAfter.shape.uuid, sourceBefore.shape.uuid);
  assert.equal(sourceAfter.settings.reductionTolerance,0);
  const appliedExport = await exported();
  assert.equal(appliedExport["model.obj"],previewExport["model.obj"], "Applying source reduction keeps preview mesh unchanged");
  await page.locator("#undo").click();
  assert.deepEqual((await projectData()).state.objects[2].shape,sourceBefore.shape,"Undo restores original editable path");
  await page.locator("#redo").click();
  assert.deepEqual((await projectData()).state.objects[2].shape,sourceAfter.shape,"Redo restores reduced source");
  const materialGeometry = await page.evaluate(() => window.__sceneSnapshot.objects.map(o => o.geometryId));
  await page.locator("#material-type").selectOption("metal");
  await expect.poll(() => page.evaluate(() => window.__sceneSnapshot.objects[2].metalness)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__sceneSnapshot.objects[2].roughness)).toBe(0.25);
  const maps = new Set();
  for (const preset of ["studio","softbox","outdoor","sunset"]) {
    await page.locator("#environment-preset").selectOption(preset);
    await expect.poll(() => page.evaluate(() => window.__sceneSnapshot.environmentPreset)).toBe(preset);
    maps.add(await page.evaluate(() => window.__sceneSnapshot.environmentId));
  }
  assert.equal(maps.size,4,"Four distinct environment maps are rendered");
  assert.deepEqual(await page.evaluate(() => window.__sceneSnapshot.objects.map(o => o.geometryId)),materialGeometry,"Material and environment changes never rebuild geometry");
  const metalState = await projectData();
  assert.equal(metalState.state.objects[2].materialType,"metal");
  assert.equal(metalState.state.view.environmentPreset,"sunset");
  await page.locator("#material-type").selectOption("standard");
  await page.locator("#environment-preset").selectOption("studio");
  await page.locator("#project-file").setInputFiles({name:"metal.pathform",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(metalState))});
  await expect(page.locator("#material-type")).toHaveValue("metal");
  await expect(page.locator("#environment-preset")).toHaveValue("sunset");
  await page.locator("#file").setInputFiles({name:"mesh-circle.svg",mimeType:"image/svg+xml",buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle id="MeshCircle" cx="50" cy="50" r="40" fill="#dddddd"/></svg>')});
  await expect(page.locator("#selected-name")).toHaveText(/MeshCircle/);
  await expect(page.locator("#color")).toHaveValue("#b0b0b0");
  await editField("bevelSize",0);
  await editField("depth",20);
  const meshIndex = (await projectData()).state.selected;
  const triangleCount = await page.evaluate(i => window.__sceneSnapshot.objects[i].triangleCount,meshIndex);
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].localZ,meshIndex)).toEqual([-10,10]);
  await editField("depth",40);
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].localZ,meshIndex)).toEqual([-20,20]);
  await editField("meshReductionPercentage",50);
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].triangleCount,meshIndex)).toBeLessThan(triangleCount);
  const reducedTriangles = await page.evaluate(i => window.__sceneSnapshot.objects[i].triangleCount,meshIndex);
  const reducedProject = await projectData();
  assert.equal(reducedProject.state.objects[meshIndex].settings.meshReductionPercentage,50);
  await page.locator("#duplicate").click();
  await expect(page.locator("#meshReductionPercentage")).toHaveValue("50");
  await editField("meshReductionPercentage",0);
  await page.locator("#project-file").setInputFiles({name:"reduced.pathform",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(reducedProject))});
  await expect(page.locator("#meshReductionPercentage")).toHaveValue("50");
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].triangleCount,meshIndex)).toBe(reducedTriangles);
  await editField("meshReductionPercentage",0);
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].triangleCount,meshIndex)).toBe(triangleCount);
  await page.locator("#hollow").check();
  await editField("wallThickness",8);
  await editField("bevelSize",16);
  await editField("bevelWidth",100);
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].effectiveBevel,meshIndex)).toBeLessThanOrEqual(4);
  await expect.poll(() => page.evaluate(i => window.__sceneSnapshot.objects[i].effectiveBevelDepth,meshIndex)).toBe(16);
  await page.locator("#wireframe-mode").selectOption("overlay");
  await page.locator("#wireframe").check();
  const wireframeBuildsBefore = await page.evaluate(() => window.__wireframeBuilds);
  await editField("depth",42);
  await expect.poll(() => page.evaluate(() => window.__wireframeBuilds)).toBe(wireframeBuildsBefore+1);
  await expect(page.locator("#sharpCorners")).toHaveCount(0);
  await expect(page.locator("#hollowCurveSafe")).toHaveCount(0);
  await expect(page.locator("#curve-add")).toHaveCount(0);
  await expect(page.locator("#curve-delete")).toHaveCount(0);
  const editorBox = await page.locator(".curve-display").boundingBox();
  const expandBox = await page.locator("#curve-expand").boundingBox();
  assert.ok(expandBox.x+expandBox.width > editorBox.x+editorBox.width-25,"Expand sits at the right edge");
  assert.ok(expandBox.y < editorBox.y+60,"Expand sits in the top row");
  const handleControlBox = await page.locator(".curve-handle-label").boundingBox();
  assert.ok(handleControlBox.x+handleControlBox.width > editorBox.x+editorBox.width-25,"Handle controls align right");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: empty startup, additive and repeated imports, previous object/camera persistence, maximum bevel axial reach and full-width L ridges, slim sidebar controls, single-click curve insertion, Delete removal, collapsible right sidebar, 3D/UV tabs, reduced orbit inertia, WebGL, SVG import, selected-object transform controls and actual gizmo drag, transform persistence/export, enlarged curve editor, per-vertex linear/Bezier and handle drag, UV transforms and vertex drag/reset, material, hollow, OBJ/MTL downloads, invalid input preservation, mobile layout, selected-only/debounced rebuilds, UV/material geometry reuse, reduction and automatic wall safety.",
  );
} finally {
  if (browser) await browser.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
  await rm(work, { recursive: true, force: true });
}
