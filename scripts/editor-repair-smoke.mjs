import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const standalone=process.env.EDITOR_REPAIR_HTML;
const url=process.env.EDITOR_REPAIR_URL||'http://127.0.0.1:5192';
const server=standalone||process.env.EDITOR_REPAIR_URL?null:spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5192','--strictPort'],{detached:true,stdio:'pipe'});
let output='',browser;server?.stdout.on('data',x=>output+=x);server?.stderr.on('data',x=>output+=x);
const svg=width=>`<svg xmlns="http://www.w3.org/2000/svg"><g id="layer-a"><path id="path-a" d="M0 0H${width}V60H0Z"/></g></svg>`;
const signature=shape=>JSON.stringify(shape,(key,value)=>key==='uuid'?undefined:value);
try{
 if(server)await expect.poll(async()=>{if(server.exitCode!==null)throw Error(output);try{return(await fetch(url)).ok;}catch{return false;}},{timeout:15000}).toBe(true);
 browser=await chromium.launch({...process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{},args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showSaveFilePicker=undefined;});
 if(standalone)await page.setContent(await readFile(standalone,'utf8'),{waitUntil:'load'});else await page.goto(url);
 await page.evaluate(()=>{window.showOpenFilePicker=undefined;window.showSaveFilePicker=undefined;});
 const upload=(id,content)=>page.locator(`#${id}`).setInputFiles({name:'baseline.svg',mimeType:'image/svg+xml',buffer:Buffer.from(content)});
 const saved=async()=>{const d=page.waitForEvent('download');await page.locator('#project-save').evaluate(el=>el.click());return JSON.parse(await readFile(await(await d).path(),'utf8')).state;};
 const edit=async()=>{
  await page.locator('#edit-path').click();await expect(page.locator('#path-editor-dialog')).toBeVisible();
  const point=page.locator('#path-editor-canvas circle[data-contour][data-point]').first(),r=await point.boundingBox();assert(r);
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+15,r.y+r.height/2+8,{steps:3});await page.mouse.up();
  await page.locator('#path-editor-import').click();await expect(page.locator('#path-editor-dialog')).not.toBeVisible();
 };
 await upload('file',svg(80));await expect(page.locator('#object-count')).toHaveText('1');
 await expect(page.locator('#edit-path')).toHaveText('パスを編集');await expect(page.locator('#source-reload')).toHaveText('パスを再読み込み');
 const editBox=await page.locator('#edit-path').boundingBox(),reloadBox=await page.locator('#source-reload').boundingBox();assert(editBox&&reloadBox);assert(Math.abs(editBox.y-reloadBox.y)<3,'Edit and reload share one toolbar row');
 await page.locator('#depth').fill('37');await page.locator('#depth').dispatchEvent('change');await page.locator('#position-x').fill('12');await page.locator('#position-x').dispatchEvent('change');
 const initial=await saved();assert(initial.objects[0].referenceShape,'Imported objects retain a restorable reference shape');
 await edit();const edited=await saved();assert.notEqual(signature(edited.objects[0].shape),signature(initial.objects[0].shape));assert.equal(signature(edited.objects[0].referenceShape),signature(initial.objects[0].referenceShape));
 // The baseline survives project persistence independently from the edited current shape.
 await page.locator('#project-file').setInputFiles({name:'edited.pathform',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'PathFormProject',version:2,state:edited}))});
 await expect(page.locator('#source-restore')).toBeEnabled();await page.locator('#source-restore').click();
 const restored=await saved();assert.equal(signature(restored.objects[0].shape),signature(initial.objects[0].shape));
 for(const key of ['id','name','settings','color','materialType','transform'])assert.deepEqual(restored.objects[0][key],edited.objects[0][key],`Restore preserves ${key}`);
 await page.locator('#undo').click();assert.equal(signature((await saved()).objects[0].shape),signature(edited.objects[0].shape),'Restoring source is undoable');await page.locator('#redo').click();
 // Reload defines a new baseline: subsequent restore must use the latest external shape.
 await page.locator('#source-reload').click();await upload('source-reload-file',svg(120));
 await expect.poll(async()=>signature((await saved()).objects[0].shape)).not.toBe(signature(initial.objects[0].shape));
 const reloaded=await saved();assert.equal(signature(reloaded.objects[0].referenceShape),signature(reloaded.objects[0].shape));
 await edit();await page.locator('#source-restore').click();
 assert.equal(signature((await saved()).objects[0].shape),signature(reloaded.objects[0].shape),'Restore uses newest reloaded source, not first import');
 // The editor can restore the external baseline as an undoable draft operation too.
 await edit();await page.locator('#edit-path').click();await expect(page.locator('#path-editor-reference-reset')).toBeEnabled();
 await page.locator('#path-editor-reference-reset').click();await page.locator('#path-editor-import').click();
 assert.equal(signature((await saved()).objects[0].shape),signature(reloaded.objects[0].shape),'Editor reference restore uses retained source baseline');
 // A duplicate keeps an independent restorable source and history does not replace its baseline.
 await edit();await page.locator('#duplicate').click();await expect(page.locator('#object-count')).toHaveText('2');
 const duplicated=await saved(),copy=duplicated.objects[1];assert.notEqual(copy.id,duplicated.objects[0].id);
 assert.equal(signature(copy.referenceShape),signature(reloaded.objects[0].referenceShape),'Duplicate carries source baseline');
 await page.locator('#source-restore').click();assert.equal(signature((await saved()).objects[1].shape),signature(reloaded.objects[0].shape));
 await page.locator('#undo').click();const copyUndone=(await saved()).objects[1];
 assert.equal(signature(copyUndone.shape),signature(copy.shape));assert.equal(signature(copyUndone.referenceShape),signature(copy.referenceShape));
 await page.locator('#delete-object').click();await expect(page.locator('#object-count')).toHaveText('1');
 const sceneBeforeRepair=await saved();
 const openRepair=async d=>{await upload('path-editor-file',`<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="black" d="${d}"/></svg>`);await expect(page.locator('#path-editor-dialog')).toBeVisible();};
 // Nonadjacent contact is highlighted; safe repair removes a zero-width spike.
 await openRepair('M0 0L20 0L20 20L10 20L10 25L10 20L0 20Z');
 await expect(page.locator('#path-editor-import')).toBeDisabled();
 assert(await page.locator('.path-editor-issue-edge').count()>0,'Problem edges are drawn visibly');
 assert(await page.locator('.path-editor-issue-point').count()>0,'Problem intersections have visible markers');
 const beforeFocus=await page.locator('#path-editor-canvas').getAttribute('viewBox');
 await page.locator('#path-editor-focus-issue').click();
 assert.notEqual(await page.locator('#path-editor-canvas').getAttribute('viewBox'),beforeFocus,'Focus moves the editor view to the reported issue');
 await page.locator('#path-editor-repair').click();await expect(page.locator('#path-editor-import')).toBeEnabled();
 await expect(page.locator('.path-editor-issue-edge')).toHaveCount(0);
 await expect(page.locator('#path-editor-canvas circle[data-contour][data-point]')).toHaveCount(4);
 await page.locator('#path-editor-undo').click();await expect(page.locator('#path-editor-import')).toBeDisabled();
 await page.locator('#path-editor-redo').click();await expect(page.locator('#path-editor-import')).toBeEnabled();
 await page.locator('#path-editor-cancel').click();assert.deepEqual((await saved()).objects,sceneBeforeRepair.objects,'Repair draft cancellation does not modify scene');
 // Ambiguous repair must retain both original points and actionable diagnostics.
 await openRepair('M0 0L20 20L0 20L20 0Z');
 const bowBefore=await page.locator('#path-editor-canvas circle[data-contour][data-point]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('cx'),n.getAttribute('cy')]));
 await page.locator('#path-editor-repair').click();await expect(page.locator('#path-editor-import')).toBeDisabled();
 const bowAfter=await page.locator('#path-editor-canvas circle[data-contour][data-point]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('cx'),n.getAttribute('cy')]));
 assert.deepEqual(bowAfter,bowBefore,'Ambiguous split repair keeps original vertices intact');
 assert(await page.locator('.path-editor-issue-edge').count()>0);await expect(page.locator('#path-editor-status')).toContainText(/分割|複数|修復/);
 await page.locator('#path-editor-cancel').click();
 // Bulk reduction acts on enabled drafts, reports per-path failures, and shares one history step.
 const circleD=(n,cx)=>'M'+Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2;return `${cx+20*Math.cos(a)} ${50+20*Math.sin(a)}`;}).join('L')+'Z';
 await upload('path-editor-file',`<svg xmlns="http://www.w3.org/2000/svg"><path id="bulk-a" d="${circleD(80,30)}"/><path id="bulk-b" d="${circleD(120,90)}"/><path id="bulk-invalid" d="M0 0L20 20L0 20L20 0Z"/><path id="bulk-excluded" d="${circleD(90,150)}"/></svg>`);
 await expect(page.locator('#path-editor-dialog')).toBeVisible();await expect(page.locator('#path-editor-tolerance')).toHaveValue('0.1');
 await page.locator('.path-editor-row input[type="checkbox"]').nth(3).uncheck();
 const outlineState=()=>page.locator('#path-editor-canvas .path-editor-outline').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
 const beforeBulk=await outlineState();await page.locator('#path-editor-reduce-all').click();
 await expect(page.locator('.path-editor-row.reduction-error')).toHaveCount(1);
 const afterBulk=await outlineState();assert(afterBulk[0].length<beforeBulk[0].length);assert(afterBulk[1].length<beforeBulk[1].length);
 assert.equal(afterBulk[2],beforeBulk[2],'Invalid path is unchanged on failed bulk reduction');assert.equal(afterBulk[3],beforeBulk[3],'Excluded path is not reduced');
 await expect(page.locator('.path-editor-row.reduction-error')).toHaveCount(1);await expect(page.locator('.path-editor-row').nth(2)).toHaveClass(/reduction-error/);
 await page.locator('#path-editor-undo').click();assert.deepEqual(await outlineState(),beforeBulk,'One undo restores all successful bulk reductions');
 await page.locator('#path-editor-redo').click();assert.deepEqual(await outlineState(),afterBulk,'One redo restores the whole bulk operation');
 await page.locator('#path-editor-cancel').click();
 // Overflow diagnostics stay editable after the reported crossing has been resolved.
 const overflowCount=6201,theta=2*Math.PI/overflowCount;
 const overflowPoints=Array.from({length:overflowCount},(_,i)=>[100+50*Math.cos(i*theta),100+50*Math.sin(i*theta)]);
 [overflowPoints[1],overflowPoints[2]]=[overflowPoints[2],overflowPoints[1]];
 await openRepair(`M${overflowPoints.map(p=>p.join(' ')).join('L')}Z`);
 assert(await page.locator('.path-editor-issue-edge').count()>0);await page.locator('#path-editor-focus-issue').click();
 const previousEditable=await page.locator('#path-editor-canvas circle[data-contour][data-point]').evaluateAll(nodes=>nodes.map(n=>`${n.dataset.contour}:${n.dataset.point}`));
 const crossingPoint=page.locator('#path-editor-canvas circle[data-contour="0"][data-point="1"]');
 const crossingBox=await crossingPoint.boundingBox();assert(crossingBox);
 const target=await page.locator('#path-editor-canvas').evaluate((canvas,p)=>{const point=new DOMPoint(p[0],p[1]).matrixTransform(canvas.getScreenCTM());return {x:point.x,y:point.y};},[100+50*Math.cos(theta/2),100+50*Math.sin(theta/2)]);
 await page.mouse.move(crossingBox.x+crossingBox.width/2,crossingBox.y+crossingBox.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:3});await page.mouse.up();
 await expect(page.locator('.path-editor-issue-edge')).toHaveCount(0);
 const remainingEditable=await page.locator('#path-editor-canvas circle[data-contour][data-point]').evaluateAll(nodes=>nodes.map(n=>`${n.dataset.contour}:${n.dataset.point}`));
 assert(previousEditable.every(key=>remainingEditable.includes(key)),'Former problem endpoints remain editable after resolving overflow crossing');
 await expect(crossingPoint).toBeVisible();await page.locator('#path-editor-cancel').click();
 // The mirror switch controls actual exported half geometry, including the optional origin cap.
 const exported=async()=>{const d=page.waitForEvent('download',download=>download.suggestedFilename().endsWith('.obj'));await page.locator('#export').click();const text=await readFile(await(await d).path(),'utf8');const vertices=text.split('\n').filter(l=>l.startsWith('v ')).map(l=>l.trim().split(/\s+/).slice(1).map(Number));const faces=text.split('\n').filter(l=>l.startsWith('f ')).map(l=>l.trim().split(/\s+/).slice(1).map(v=>vertices[Number(v.split('/')[0])-1]));return {vertices,originFaces:faces.filter(face=>face.every(v=>Math.abs(v[2])<1e-6)).length};};
 await expect(page.locator('#extrusionMirror')).toBeChecked();await expect(page.locator('#extrusionCap')).toBeDisabled();
 if(process.env.EDITOR_REPAIR_STATE)await writeFile(process.env.EDITOR_REPAIR_STATE,JSON.stringify({format:'PathFormProject',version:2,state:await saved()}));
 const mirrorObj=await exported(),zs=mirrorObj.vertices.map(v=>v[2]);assert(Math.abs(Math.min(...zs)+18.5)<1e-5);assert(Math.abs(Math.max(...zs)-18.5)<1e-5);
 await page.locator('#extrusionMirror').uncheck();await expect(page.locator('#extrusionCap')).toBeEnabled();
 await page.waitForTimeout(150);assert(!await page.locator('#message').evaluate(el=>el.classList.contains('error')),await page.locator('#message').textContent());
 const cappedHalf=await exported(),halfZ=cappedHalf.vertices.map(v=>v[2]);assert(Math.abs(Math.min(...halfZ))<1e-6);assert(Math.abs(Math.max(...halfZ)-18.5)<1e-5);assert(cappedHalf.originFaces>0,'Enabled cap closes exported origin plane');
 await page.locator('#extrusionCap').uncheck();const openHalf=await exported();assert.equal(openHalf.originFaces,0,'Disabled cap leaves exported origin plane open');
 const halfState=await saved();await page.locator('#project-file').setInputFiles({name:'half.pathform',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'PathFormProject',version:2,state:halfState}))});
 await expect(page.locator('#extrusionMirror')).not.toBeChecked();await expect(page.locator('#extrusionCap')).not.toBeChecked();
 await page.locator('#preset-settings').evaluate(el=>el.open=true);await page.locator('#preset-name').fill('Positive open half');await page.locator('#preset-save').click();
 await page.locator('#extrusionMirror').check();await page.locator('#preset-apply').click();await expect(page.locator('#extrusionMirror')).not.toBeChecked();await expect(page.locator('#extrusionCap')).not.toBeChecked();
 await page.locator('#undo').click();await expect(page.locator('#extrusionMirror')).toBeChecked();await page.locator('#redo').click();await expect(page.locator('#extrusionMirror')).not.toBeChecked();
 assert.deepEqual(errors,[]);if(standalone)assert.deepEqual(requests,[]);
 console.log('Editor repair checks passed: toolbar labels/layout, persistent reference baseline, edit/restore/undo, latest reloaded baseline, diagnostic markers/focus, conservative repair/undo/refusal, overflow point persistence, bulk reduction/history, mirrored/half OBJ cap/state/preset.');
}finally{await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}
