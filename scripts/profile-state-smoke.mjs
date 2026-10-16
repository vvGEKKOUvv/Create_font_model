import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(await readFile('dist/PathForm.html','utf8'),{waitUntil:'load'});
 await page.evaluate(()=>window.showSaveFilePicker=undefined);
 await page.locator('#file').setInputFiles({name:'profiles.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H60V60H0Z"/></svg>')});
 await expect(page.locator('#object-count')).toHaveText('1');
 const saved=async()=>{const event=page.waitForEvent('download');await page.locator('#project-save').evaluate(n=>n.click());return JSON.parse(await readFile(await(await event).path(),'utf8'));};
 const legacy=await saved(),original=legacy.state.objects[0].settings.curvePoints;delete legacy.state.objects[0].settings.innerCurvePoints;
 await page.locator('#project-file').setInputFiles({name:'legacy.pathform',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
 await page.locator('#curve-point-mode').selectOption('linear');
 const changed=await saved();assert.notDeepEqual(changed.state.objects[0].settings.curvePoints,original);
 assert.deepEqual(changed.state.objects[0].settings.innerCurvePoints,original,'Editing a legacy outer curve freezes the previously inherited inner curve');
 assert.deepEqual(errors,[]);console.log('Profile state checks passed: legacy outer editing retains independent inner settings.');
} finally {await browser.close();}
