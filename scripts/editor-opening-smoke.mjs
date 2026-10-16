import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.setContent(await readFile('dist/PathForm.html','utf8'),{waitUntil:'load'});
 const count=4500,points=Array.from({length:count},(_,i)=>`${100+70*Math.cos(i/count*Math.PI*2)} ${100+70*Math.sin(i/count*Math.PI*2)}`);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg"><path id="dense" d="M${points.join('L')}Z"/></svg>`;
 const started=Date.now();
 await page.locator('#dropzone').evaluate((node,text)=>{const data=new DataTransfer();data.items.add(new File([text],'dense.svg',{type:'image/svg+xml'}));node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));},svg);
 await expect(page.locator('#path-editor-dialog')).toBeVisible({timeout:15000});
 const elapsed=Date.now()-started;
 await expect(page.locator('#object-count')).toHaveText('0');
 await expect(page.locator('#path-editor-canvas circle[data-point]')).toHaveCount(0);
 await expect(page.locator('#path-editor-import')).toBeEnabled();
 const target=await page.locator('#path-editor-canvas').evaluate(node=>{const p=new DOMPoint(170,100).matrixTransform(node.getScreenCTM());return{x:p.x,y:p.y};});
 await page.mouse.click(target.x,target.y);
 await expect.poll(()=>page.locator('#path-editor-canvas circle[data-point]').count()).toBeGreaterThan(0);
 assert(await page.locator('#path-editor-canvas circle[data-point]').count()<=4);
 await page.locator('#path-editor-cancel').click();await expect(page.locator('#object-count')).toHaveText('0');
 assert.deepEqual(errors,[]);console.log(`Dense editor opening passed: ${count} vertices, ${elapsed} ms, no 3D build before editor, sparse editable points.`);
} finally {await browser.close();}
