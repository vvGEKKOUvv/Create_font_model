import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
await mkdir(resolve(root,'docs/screenshots'),{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1.5});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(await readFile(resolve(root,'downloads/PathForm.html'),'utf8'),{waitUntil:'load'});
 await expect(page.locator('#file')).toBeAttached();
 const shot=async name=>{if(name==='curve')await page.locator('#bevel-curve-settings').scrollIntoViewIfNeeded();if(name==='uv')await page.locator('#uv-settings').scrollIntoViewIfNeeded();await page.waitForTimeout(220);await page.screenshot({path:resolve(root,`docs/screenshots/${name}.png`)});};
 const panels=async ids=>page.evaluate(ids=>{
  document.querySelectorAll('aside.right-panel > details').forEach(el=>el.open=ids.includes(el.id)||(ids.includes('source')&&!!el.querySelector('#file')));
  document.querySelector('aside.right-panel').scrollTop=0;
 },ids);
 await panels(['source','objects-details']);await shot('import');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 170"><path id="L-plate" d="M20 20H65V115H140V150H20Z"/><path id="round-plate" d="M160 20H220V80H160Z"/></svg>';
 await page.locator('#file').setInputFiles({name:'guide.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await expect(page.locator('#object-count')).toHaveText('2');
 await page.locator('[data-object="0"]').click();
 const field=async(id,value)=>{await page.locator('#'+id).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.waitForTimeout(180);};
 await field('depth',28);await field('bevelSize',6);await field('bevelWidth',6);await field('bevelSegments',1);
 await page.locator('#fit').click();
 await panels(['objects-details','reduction-settings']);await shot('overview');await shot('objects');
 await page.locator('.transform-panel').evaluate(el=>el.open=true);await shot('transform');
 await panels(['bevel-settings']);await page.locator('#depth').evaluate(el=>el.closest('details').open=true);await shot('bevel');
 await panels(['bevel-curve-settings']);await page.locator('[data-curve-point="1"]').click();await shot('curve');
 await panels(['hollow-settings','bevel-settings']);await page.locator('#hollow').check();await field('wallThickness',7);await page.locator('#wireframe').check();await shot('hollow');await page.locator('#wireframe').uncheck();
 await page.locator('#hollow').uncheck();await page.waitForTimeout(180);
 await panels(['uv-settings']);await page.locator('#tab-uv').click();await expect(page.locator('#front-uv-fit')).toHaveValue('contain');await shot('uv');
 await page.locator('#tab-3d').click();await page.locator('#material-type').evaluate(el=>el.closest('details').open=true);
 await panels([]);await page.locator('#material-type').evaluate(el=>el.closest('details').open=true);await page.locator('#material-type').selectOption('metal');await page.locator('#color').fill('#c9a65a');await page.locator('#color').dispatchEvent('input');await shot('material');
 await panels(['preset-settings']);await page.locator('#preset-name').fill('ゴールド・ベベル');await page.locator('#preset-save').click();await shot('presets');
 await panels(['objects-details']);await page.locator('#edit-path').click();await expect(page.locator('#path-editor-canvas')).toBeVisible();await shot('editor');await page.locator('#path-editor-cancel').click();
 await panels(['objects-details']);await shot('save');
 if(errors.length)throw new Error(errors.join('\n'));
 const content=JSON.parse(await readFile(resolve(root,'docs/manual-content.json'),'utf8'));
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const pages=content.pages;
 const css=`@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#182a30;font-family:"Noto Sans CJK JP",sans-serif;font-size:10pt;line-height:1.7}.sheet{width:210mm;height:297mm;padding:15mm 15mm 18mm;position:relative;break-after:page;overflow:hidden}.sheet:last-child{break-after:auto}.eyebrow{color:#53736d;letter-spacing:2px;font-size:8pt;font-weight:bold}h1{font-size:32pt;line-height:1.4;margin:8mm 0 2mm}h2{font-size:20pt;line-height:1.45;margin:4mm 0}p{margin:2mm 0 4mm}.lead{color:#425a61;font-size:10.5pt}.picture{height:112mm;display:flex;justify-content:center;align-items:center;margin:5mm 0;background:#152026;border-radius:3mm;overflow:hidden}.picture img{width:100%;height:100%;object-fit:contain}.steps{padding:0;list-style:none;counter-reset:step}.steps li{counter-increment:step;padding:1.7mm 0 1.7mm 10mm;position:relative}.steps li:before{content:counter(step);position:absolute;left:0;top:2mm;width:6mm;height:6mm;line-height:6mm;text-align:center;border-radius:50%;background:#d9eddb;color:#214d38;font-size:9pt;font-weight:bold}.tip{background:#eff5f2;border-left:1mm solid #73a88a;padding:3mm 4mm;margin-top:4mm;font-size:9pt}.footer{position:absolute;bottom:8mm;left:15mm;right:15mm;border-top:.2mm solid #d6e1dd;padding-top:2mm;display:flex;justify-content:space-between;color:#687e79;font-size:8pt}.toc{columns:2;column-gap:10mm;margin:6mm 0}.toc a{display:block;color:#214d38;text-decoration:none;margin:1.5mm 0;font-size:9pt}.cover-image{height:101mm}.version{font-size:9pt;color:#6c7b78}.note{font-size:9pt;color:#687e79}`;
 const image=async name=>'data:image/png;base64,'+(await readFile(resolve(root,`docs/screenshots/${name}.png`))).toString('base64');
 const footer=n=>`<div class="footer"><span>PATH / FORM　取扱説明書</span><span>${n} / ${pages.length+1}</span></div>`;
 let html=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>PATH / FORM 取扱説明書</title><style>${css}</style><body><section class="sheet"><div class="eyebrow">PATH / FORM　USER GUIDE</div><h1>パスから、立体をつくる。</h1><p class="lead">画像でわかる取扱説明書</p><p class="version">2026年10月17日版 ／ PCのブラウザで使うダウンロード版</p><div class="picture cover-image"><img src="${await image('overview')}"></div><div class="toc">${pages.map((p,i)=>`<a href="#p${i}">${String(i+2).padStart(2,'0')}　${escape(p.title)}</a>`).join('')}</div><p class="note">画面は操作例です。ブラウザやウィンドウの大きさにより表示が異なります。<br>作業を再開するには「状態を保存」で .pathform を保存してください。</p>${footer(1)}</section>`;
 for(const [i,p] of pages.entries())html+=`<section class="sheet" id="p${i}"><div class="eyebrow">GUIDE ${String(i+1).padStart(2,'0')}</div><h2>${escape(p.title)}</h2><p class="lead">${escape(p.lead)}</p><div class="picture"><img src="${await image(p.image)}"></div><ol class="steps">${p.steps.map(s=>`<li>${escape(s)}</li>`).join('')}</ol>${p.tip?`<div class="tip">${escape(p.tip)}</div>`:''}${footer(i+2)}</section>`;
 html+='</body></html>';
 await writeFile(resolve(root,'dist/PathForm_Manual.html'),html);
 const print=await browser.newPage();await print.setContent(html,{waitUntil:'load'});await print.evaluate(()=>document.fonts.ready);
 // Reject overflowing pages so text never disappears behind a page boundary.
 const bad=await print.locator('.sheet').evaluateAll(nodes=>nodes.map((n,i)=>({page:i+1,overflow:n.scrollHeight>n.clientHeight+1})).filter(n=>n.overflow));if(bad.length)throw new Error('Manual page overflow: '+JSON.stringify(bad));
 await print.pdf({path:resolve(root,'downloads/PathForm_Manual.pdf'),printBackground:true,preferCSSPageSize:true});
 console.log(`Manual generated: ${pages.length+1} pages, ${errors.length} browser errors.`);
}finally{await browser.close();}
