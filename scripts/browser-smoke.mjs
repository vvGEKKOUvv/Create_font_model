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
    const source = await response.text();
    assert(source.includes("renderer.render(scene, camera);"));
    await route.fulfill({
      response,
      body: source.replace(
        "renderer.render(scene, camera);",
        `scene.updateMatrixWorld(true);
       window.__sceneSnapshot = {
         objects: group.children.map(mesh => ({
           matrix: mesh.matrixWorld.toArray(),
           depth: mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z,
           point: new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0).applyMatrix4(mesh.matrixWorld).toArray()
         })),
         camera: camera.matrixWorld.toArray(),
         target: controls.target.toArray()
       };
       renderer.render(scene, camera);`,
      ),
    });
  });
  await page.goto("http://127.0.0.1:5184");
  await expect(page.locator("#object-count")).toHaveText("2");
  await expect(page.locator("#viewport canvas")).toBeVisible();
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
      await expect.poll(() => downloads.length).toBe(2);
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
  const first = await exported();
  assert.match(first["model.obj"], /o Ring/);
  assert.match(first["model.obj"], /o Arrow/);
  assert.match(first["model.obj"], /mtllib model\.mtl/);
  assert.equal((first["model.mtl"].match(/newmtl /g) || []).length, 2);
  await page.locator("#uvScaleX").fill("2");
  const changed = await exported();
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
  await page.locator('[data-object="0"]').click();
  await expect(page.locator("#depth")).toHaveValue("24");
  await page.locator('[data-object="1"]').click();
  await expect(page.locator("#depth")).toHaveValue("40");
  await page.locator("#color").evaluate((el) => {
    el.value = "#ff0000";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const colored = await exported();
  assert.match(colored["model.mtl"], /newmtl material_2\nKd 1 0 0/);
  const curve = page.locator(".curve-display svg");
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
  await curve.dblclick({
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
  await page.locator("#curve-delete").click();
  await expect(points).toHaveCount(3);
  await page.locator("#curve-add").click();
  await expect(points).toHaveCount(4);
  await curve.focus();
  await page.keyboard.press("Delete");
  await expect(points).toHaveCount(3);
  await page.locator("#file").setInputFiles({
    name: "rectangle.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="Box" d="M0 0H100V100H0Z"/></svg>',
    ),
  });
  await expect(page.locator("#object-count")).toHaveText("1");
  await page.locator("#hollow").check();
  await expect(page.locator("#message")).not.toHaveClass(/error/);
  const hollow = await exported();
  assert.match(hollow["model.obj"], /o Box/);
  assert(!/NaN|Infinity/.test(hollow["model.obj"]));
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
      curve: 0.5,
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
  await page.locator("#file").setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10L0 10L10 0Z"/></svg>',
    ),
  });
  await expect(page.locator("#message")).toHaveClass(/error/);
  await expect(page.locator("#object-count")).toHaveText("1");
  await expect(page.locator("#selected-name")).toHaveText("Box");
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
    "Browser smoke passed: WebGL, SVG import, independent settings, curve editing, UV transforms and vertex drag/reset, material, hollow, OBJ/MTL downloads, invalid input preservation, mobile layout.",
  );
} finally {
  if (browser) await browser.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
  await rm(work, { recursive: true, force: true });
}
