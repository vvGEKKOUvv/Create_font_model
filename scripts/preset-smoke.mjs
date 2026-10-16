import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { normalizeProfile } from '../src/bevel-profile.js';
const precise=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Math.round(v*1e12)/1e12:v));
const html=process.env.PRESET_HTML,url=process.env.PRESET_URL||'http://127.0.0.1:5189';
const server=html||process.env.PRESET_URL?null:spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5189','--strictPort'],{detached:true,stdio:'pipe'});
let log='',browser;server?.stdout.on('data',b=>log+=b);server?.stderr.on('data',b=>log+=b);
try {
 if(server)await expect.poll(async()=>{if(server.exitCode!==null)throw Error(log);try{return(await fetch(url)).ok;}catch{return false;}},{timeout:15000}).toBe(true);
 browser=await chromium.launch({...process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{},args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const errors=[],requests=[];
 const open=async()=>{const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showDirectoryPicker=undefined;});if(html)await page.setContent(await readFile(html,'utf8'),{waitUntil:'load'});else await page.goto(url);await page.evaluate(()=>{window.showSaveFilePicker=undefined;window.showDirectoryPicker=undefined;});await page.locator('#preset-settings').evaluate(el=>el.open=true);return page;};
 let page=await open();
 const saved=async()=>{const d=page.waitForEvent('download');await page.locator('#project-save').click();return JSON.parse(await readFile(await(await d).path(),'utf8')).state;};
 const load=async state=>{await page.locator('#message').evaluate(el=>el.textContent='');await page.locator('#project-file').setInputFiles({name:'preset-test.pathform',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'PathFormProject',version:2,state}))});await expect(page.locator('#message')).toHaveText('保存した状態を読み込みました。');await expect(page.locator('#object-count')).toHaveText('3');await page.locator('#preset-settings').evaluate(el=>el.open=true);};
 const row=i=>page.locator(`[data-object="${i}"]`);
 await expect(page.locator('#preset-save')).toBeDisabled();await expect(page.locator('#preset-apply')).toBeDisabled();
 await page.locator('#file').setInputFiles({name:'preset.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H80V80H0Z"/><path d="M100 0H180V80H100Z"/><path d="M200 0H280V80H200Z"/></svg>')});await expect(page.locator('#object-count')).toHaveText('3');
 let state=await saved();
 const custom=state.objects[0];Object.assign(custom.settings,{depth:28,bevelSize:2,bevelWidth:3,bevelSegments:2,hollow:false,uvScaleX:1.7,uvScaleY:0.8,uvOffsetX:0.2,uvOffsetY:-0.1,uvRotation:22,uvEdits:{'0,0':[0.11,0.22]}});
 delete custom.settings.frontUV;delete custom.settings.sideUV;
 custom.settings.curvePoints[1].y=0.001;custom.settings.curvePoints[0].out.y=0;custom.settings.innerCurvePoints[1].y=0.35;for(const key of ['curvePoints','innerCurvePoints'])custom.settings[key]=normalizeProfile(custom.settings[key]);custom.validSettings=structuredClone(custom.settings);custom.color='#886633';custom.materialType='metal';delete custom.surfaceMaterials;custom.name='Preset source';
 for(let i=0;i<3;i++){state.objects[i].transform={position:[i*3,i*2,i],rotation:[0,0,i*0.1],scale:[1+i*0.1,1,1]};}
 state.objects[1].settings.uvEdits={'0,0':[0.3,0.4]};state.objects[1].validSettings=structuredClone(state.objects[1].settings);
 state.selected=0;state.selectedIds=[custom.id];state.selectionAnchorId=custom.id;await load(state);state=await saved();
 await page.locator('#preset-name').fill('QA metal profile');await page.locator('#preset-save').click();await expect(page.locator('#preset-list option')).toHaveCount(1);
 const sourceBefore=await saved();await page.locator('#preset-apply').click();const sourceAfter=await saved();
 assert.deepEqual(sourceAfter.objects[0].settings.uvEdits,sourceBefore.objects[0].settings.uvEdits,'No-op preset with heavily curved profile preserves manual UV edits exactly');
 for(const key of ['id','name','shape','pivot','transform','visible'])assert.deepEqual(sourceAfter.objects[0][key],sourceBefore.objects[0][key],`No-op preset preserves ${key}`);
 assert.deepEqual(precise(sourceAfter.objects),precise(sourceBefore.objects),'No-op preset preserves all object state within profile floating-point precision');state=sourceAfter;
 const download=page.waitForEvent('download');await page.locator('#preset-export').click();const library=await readFile(await(await download).path(),'utf8');JSON.parse(library);
 await row(1).click();await row(2).click({modifiers:['Control']});const before=await saved();await page.locator('#preset-apply').click();const after=await saved();
 for(let i=1;i<3;i++){
  const expected=structuredClone(state.objects[0].settings);delete expected.uvEdits;const actual=structuredClone(after.objects[i].settings);delete actual.uvEdits;assert.deepEqual(precise(actual),precise(expected),'Preset transfers all reusable geometry, curves and UV parameters');
  assert.deepEqual(after.objects[i].settings.uvEdits??{}, {},'Applying changed parameters discards topology-specific UV corrections');
  assert.equal(after.objects[i].color,custom.color);assert.equal(after.objects[i].materialType,'metal');assert.deepEqual(after.objects[i].surfaceMaterials,state.objects[0].surfaceMaterials,'Preset transfers both explicit surface materials');
  for(const key of ['id','name','shape','pivot','transform','visible'])assert.deepEqual(after.objects[i][key],before.objects[i][key],`Apply preserves ${key}`);
 }
 assert.deepEqual(after.objects[0],before.objects[0],'Unselected model remains untouched');
 await page.locator('#undo').click();assert.deepEqual((await saved()).objects,before.objects,'One undo reverses the whole multiple-object preset application');await page.locator('#redo').click();assert.deepEqual((await saved()).objects,after.objects);
 if(!html){await page.reload();await page.locator('#preset-settings').evaluate(el=>el.open=true);await expect(page.locator('#preset-list option')).toHaveCount(1);assert.match(await page.locator('#preset-list').textContent(),/QA metal profile/);}
 // Import the downloaded reusable library in a completely fresh context, with no saved models.
 const oldPage=page;page=await open();await expect(page.locator('#preset-list option')).toHaveCount(0);
 await page.locator('#preset-import').setInputFiles({name:'portable.pathform-presets',mimeType:'application/json',buffer:Buffer.from(library)});await expect(page.locator('#preset-list option')).toHaveCount(1);await expect(page.locator('#object-count')).toHaveText('0');await expect(page.locator('#preset-apply')).toBeDisabled();
 await load(before);await page.locator('#preset-apply').click();const imported=await saved();assert.deepEqual(precise(imported.objects),precise(after.objects),'Export/import produces identical reusable preset application');
 const stable=await saved();const options=await page.locator('#preset-list').innerHTML();await page.locator('#preset-import').setInputFiles({name:'bad.pathform-presets',mimeType:'application/json',buffer:Buffer.from('{"format":"PathFormPresets","version":1,"presets":[{"name":"bad","settings":{"depth":-1}}]}')});await expect(page.locator('#message')).toContainText('不正');assert.equal(await page.locator('#preset-list').innerHTML(),options);assert.deepEqual((await saved()).objects,stable.objects,'Invalid import leaves models and library unchanged');
 page.on('dialog',d=>d.accept());await page.locator('#preset-delete').click();await expect(page.locator('#preset-list option')).toHaveCount(0);assert.deepEqual((await saved()).objects,stable.objects,'Deleting a preset never deletes its models');
 await page.setViewportSize({width:390,height:844});const size=await page.locator('#preset-settings').evaluate(el=>({s:el.scrollWidth,c:el.clientWidth}));assert(size.s<=size.c+1,'Preset controls fit narrow viewport');
 assert.deepEqual(errors,[]);if(html)assert.deepEqual(requests,[],'Standalone preset operations require no network');await oldPage.close();console.log('Preset browser checks passed: reusable curves/UV/material, multi-apply/undo, protected object identity/transforms, persistence, portable export/import, invalid import, deletion and offline operation.');
} finally {await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}
