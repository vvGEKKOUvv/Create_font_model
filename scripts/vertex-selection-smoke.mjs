import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const html=process.env.VERTEX_SELECTION_HTML,url=process.env.VERTEX_SELECTION_URL||'http://127.0.0.1:5194';
const server=html||process.env.VERTEX_SELECTION_URL?null:spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5194','--strictPort'],{detached:true,stdio:'pipe'});
let browser,log='';server?.stdout.on('data',b=>log+=b);server?.stderr.on('data',b=>log+=b);
try {
 if(server)await expect.poll(async()=>{if(server.exitCode!==null)throw Error(log);try{return(await fetch(url)).ok;}catch{return false;}},{timeout:15000}).toBe(true);
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 if(html)await page.setContent(await readFile(html,'utf8'),{waitUntil:'load'});else await page.goto(url);
 await page.evaluate(()=>{window.showSaveFilePicker=undefined;window.showDirectoryPicker=undefined;});
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path id="box" d="M20 20H100V100H20Z"/><path id="hole" fill-rule="evenodd" d="M130 20H230V120H130Z M150 40L180 90L210 40Z"/><path id="triangle" d="M260 20L340 100L260 100Z"/></svg>');
 await page.locator('#file').setInputFiles({name:'vertex-selection.svg',mimeType:'image/svg+xml',buffer:svg});await expect(page.locator('#object-count')).toHaveText('3');
 const canvas=page.locator('#path-editor-canvas'),points=page.locator('#path-editor-canvas circle[data-contour][data-point]');
 const coords=()=>points.evaluateAll(nodes=>nodes.map(n=>[+n.getAttribute('cx'),+n.getAttribute('cy')]));
 const row=i=>page.locator(`[data-object="${i}"]`),undo=()=>page.locator('#path-editor-undo').click();
 const open=async i=>{await row(i).click();await page.locator('#edit-path').click();await expect(page.locator('#path-editor-dialog')).toBeVisible();};
 const rectangle=async indices=>{
   const boxes=await Promise.all(indices.map(i=>points.nth(i).boundingBox()));assert(boxes.every(Boolean));
   const x1=Math.min(...boxes.map(b=>b.x))-10,y1=Math.min(...boxes.map(b=>b.y))-10,x2=Math.max(...boxes.map(b=>b.x+b.width))+10,y2=Math.max(...boxes.map(b=>b.y+b.height))+10;
   await page.mouse.move(x1,y1);await page.mouse.down();await page.mouse.move(x2,y2,{steps:6});await page.mouse.up();
 };
 await open(0);await expect(points).toHaveCount(4);const before=await coords();
 await rectangle([0,1]);await expect(canvas.locator('circle.selected')).toHaveCount(2);
 const b=await points.first().boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+16,b.y+b.height/2+11,{steps:5});await page.mouse.up();
 const moved=await coords(),delta=moved[0].map((v,i)=>v-before[0][i]);assert(Math.hypot(...delta)>0);
 for(let i=0;i<4;i++)for(let axis=0;axis<2;axis++)assert(Math.abs(moved[i][axis]-before[i][axis]-(i<2?delta[axis]:0))<1e-6,'group move preserves relative positions and untouched vertices');
 await undo();assert.deepEqual(await coords(),before,'one undo restores complete group drag');
 await rectangle([0,1]);await expect(canvas.locator('circle.selected')).toHaveCount(2);
 await points.nth(2).click({modifiers:['Control']});await expect(canvas.locator('circle.selected')).toHaveCount(3);
 await page.locator('#path-editor-cancel').click();
 // Removing one vertex of a triangular hole removes the hole, not its outer path.
 await open(1);await expect(points).toHaveCount(7);await canvas.locator('circle[data-contour="1"]').first().click();await canvas.focus();await page.keyboard.press('Delete');await expect(points).toHaveCount(4);await undo();await expect(points).toHaveCount(7);
 await canvas.locator('circle[data-contour="1"]').first().click();await page.locator('#path-editor-delete-point').click();await page.locator('#path-editor-import').click();await expect(page.locator('#object-count')).toHaveText('3');
 await page.locator('#undo').click();await open(1);await expect(points).toHaveCount(7);await page.locator('#path-editor-cancel').click();
 // A degenerate outer contour removes its object; main undo restores it.
 await open(2);await expect(points).toHaveCount(3);await points.first().click();await canvas.focus();await page.keyboard.press('Delete');await expect(points).toHaveCount(0);await expect(page.locator('#path-editor-import')).toBeEnabled();await page.locator('#path-editor-import').click();await expect(page.locator('#object-count')).toHaveText('2');await page.locator('#undo').click();await expect(page.locator('#object-count')).toHaveText('3');
 // Delete every path in one edit session, apply an empty project, then undo.
 await row(0).click();await row(2).click({modifiers:['Shift']});await page.locator('#edit-path').click();
 for(let i=0;i<3;i++) {await page.locator('.path-editor-select').nth(i).click();const n=await points.count();assert(n>=3);await rectangle(Array.from({length:n},(_,j)=>j));await canvas.focus();await page.keyboard.press('Delete');await expect(points).toHaveCount(0);}
 await expect(page.locator('#path-editor-import')).toBeEnabled();await page.locator('#path-editor-import').click();await expect(page.locator('#object-count')).toHaveText('0');await page.locator('#undo').click();await expect(page.locator('#object-count')).toHaveText('3');
 assert.deepEqual(errors,[]);if(html)assert.deepEqual(requests,[],'offline standalone makes no network requests');
 console.log('Vertex rectangle selection, group drag, toggled selection, hole/path deletion, empty project and undo passed.');
} finally {await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}
