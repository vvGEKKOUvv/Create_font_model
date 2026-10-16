import './path-editor.css';
import { snapshotDraft, createDraftHistory } from './path-editor-history.js';
import { PATH_EDITOR_VERTEX_LIMIT, createPathDrafts, createObjectDrafts, validateDraft, toImportEntry, simplifyDraft, repairDraft, resetReferenceDraft, closeDraft, resetDraft, moveDraftPoint, deleteDraftPoint, addDraftPoint } from './path-editor-model.js';

const NS = 'http://www.w3.org/2000/svg';
const svgNode = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/** Edit a separate import draft; the current project is untouched until confirmation. */
export async function editSvgPaths(text, fileName = 'SVG') {
  return editDrafts(createPathDrafts(text), fileName);
}
export async function editImportPaths(objects, fileName = 'SVG', warnings = []) {
  return editDrafts({ drafts: createObjectDrafts(objects), warnings }, fileName);
}
/** Reopen a confirmed editor draft after a later step was cancelled. Session stays in memory only. */
export async function resumeImportPaths(result, fileName = 'SVG') {
  const session=result?.editorSession;
  if(session?.drafts?.length) return editDrafts({drafts:session.drafts,warnings:result.warnings||session.warnings||[]},fileName,!!session.existing,session);
  return editImportPaths(result?.objects||[],fileName,result?.warnings||[]);
}
export async function editExistingPaths(objects) {
  return editDrafts({ drafts: createObjectDrafts(objects), warnings: [] }, '選択中のパス', true);
}
function editDrafts({ drafts, warnings = [] }, fileName, existing = false, session = null) {
  if (!drafts.length) throw new Error('編集できるパスがありません。');
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'path-editor-dialog';
    dialog.className = 'path-editor-dialog';
    dialog.innerHTML = `<header><div><strong>パス調整エディタ</strong><span class="path-editor-filename"></span></div><button id="path-editor-cancel" type="button">キャンセル</button></header><div class="path-editor-body"><aside><div class="path-editor-actions"><button id="path-editor-undo" type="button">元に戻す</button><button id="path-editor-redo" type="button">やり直す</button></div><div class="path-editor-list" aria-label="読み込むパス"></div><label class="path-editor-field">名前<input id="path-editor-name" type="text"></label><div class="path-editor-actions"><button id="path-editor-close" type="button">輪郭を閉じる</button><button id="path-editor-reset" type="button">編集開始時に戻す</button></div><button id="path-editor-reference-reset" type="button">参照形状に戻す</button><label class="path-editor-field">削減の許容誤差<input id="path-editor-tolerance" type="number" min="0" value="0.5" step="0.1"></label><button id="path-editor-reduce" type="button">頂点を削減</button><div class="path-editor-actions"><button id="path-editor-repair" type="button">輪郭を修復</button><button id="path-editor-focus-issue" type="button">問題箇所を表示</button></div><div class="path-editor-actions"><button id="path-editor-add-point" type="button">辺に頂点を追加</button><button id="path-editor-delete-point" type="button">選択頂点を削除</button></div><p id="path-editor-status" role="status" aria-live="polite"></p></aside><div class="path-editor-preview"><svg id="path-editor-canvas" tabindex="0" role="group" aria-label="パスの頂点編集"></svg><p>頂点をドラッグして移動 · 辺をダブルクリックして追加 · Delで削除 · ホイールで拡大縮小 · Space＋ドラッグ／中ボタンで移動<br>頂点を編集すると輪郭は折れ線になります。</p><div class="path-editor-view-tools"><button id="path-editor-pan" type="button" aria-pressed="false">ビューを移動</button><button id="path-editor-fit" type="button">全体を表示</button></div></div></div><footer><span class="path-editor-summary"></span><button id="path-editor-import" type="button">選択したパスを追加</button></footer>`;
    dialog.querySelector('.path-editor-filename').textContent = fileName;
    document.body.append(dialog);
    const find = (id) => dialog.querySelector(`#path-editor-${id}`);
    if (existing) find('import').textContent = '変更を適用';
    const canvas = find('canvas'), list = dialog.querySelector('.path-editor-list');
    let active = Math.min(drafts.length-1,Math.max(0,session?.active||0)), selected = session?.selected ? {...session.selected} : null, dragging = null, view = session?.view ? [...session.view] : null, notice = '', finished = false, issueCursor = session?.issueCursor||0;
    let dragFrame = null, pendingPoint = null, dragBefore = null, panning = null, panMode = !!session?.panMode, spaceHeld = false;
    const history = session?.history || createDraftHistory();
    const problemVertices = session?.problemVertices || new WeakMap();
    find('tolerance').value = session?.tolerance ?? '0.5';
    find('pan').setAttribute('aria-pressed',String(panMode));
    canvas.classList.toggle('pan-mode',panMode);
    const current = () => drafts[active];
    const validationCache = new WeakMap();
    const validationOf = draft => {
      if (!validationCache.has(draft)) validationCache.set(draft, validateDraft(draft));
      return validationCache.get(draft);
    };
    function finish(value) {
      if (finished) return;
      finished = true;
      if(value) value.editorSession={drafts,warnings,existing,active,selected:selected?{...selected}:null,view:view?[...view]:null,tolerance:find('tolerance').value,panMode,issueCursor,history,problemVertices};
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    function fit() {
      const points = drafts.flatMap(draft => draft.contours.flatMap(contour => contour.points)).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!points.length) { view = [-10,-10,20,20]; return; }
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (const p of points) { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
      const width = Math.max(1,maxX-minX), height = Math.max(1,maxY-minY);
      const padding = Math.max(width,height) * .08;
      view = [minX-padding,minY-padding,width+padding*2,height+padding*2];
    }
    function point(e) {
      const matrix = canvas.getScreenCTM();
      return matrix ? new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse()) : null;
    }
    function renderCanvas() {
      canvas.setAttribute('viewBox', view.join(' '));
      canvas.replaceChildren();
      const pixelScale = canvas.getScreenCTM()?.a || 1;
      const radius = 4.5 / Math.abs(pixelScale);
      const activeDraft=current();
      let remembered=problemVertices.get(activeDraft);
      if(!remembered) {remembered=new Set();problemVertices.set(activeDraft,remembered);}
      // Remember point objects so fixing an error does not hide its editable endpoints.
      // Array indices may shift after insertion/deletion; topology replacements discard old objects.
      const livePoints=new Set(activeDraft.contours.flatMap(contour=>contour.points));
      for(const p of remembered)if(!livePoints.has(p))remembered.delete(p);
      for(const issue of validationOf(activeDraft).issues||[])for(const edge of issue.edges||[]) {
        const contour=activeDraft.contours[edge.contourIndex];if(!contour)continue;
        const a=contour.points[edge.edgeIndex],b=contour.points[(edge.edgeIndex+1)%contour.points.length];
        if(a)remembered.add(a);if(b)remembered.add(b);
      }
      const selectedPoint=selected&&activeDraft.contours[selected.ci]?.points[selected.pi];if(selectedPoint)remembered.add(selectedPoint);
      drafts.forEach((draft, index) => draft.contours.forEach((contour, ci) => {
        if (!contour.points.length) return;
        const path = svgNode('path', { d: contour.points.map((p,i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (contour.closed ? ' Z' : ''), class: `path-editor-outline ${index === active ? 'active' : ''} ${draft.enabled ? '' : 'excluded'}`, 'vector-effect':'non-scaling-stroke', 'data-draft':index, 'data-outline-contour':ci });
        path.addEventListener('click', () => { if (panMode || spaceHeld) return; active = index; selected = null; render(); });
        canvas.append(path);
        if (index !== active) return;
        const overflow=draft.contours.reduce((count,c)=>count+c.points.length,0)>PATH_EDITOR_VERTEX_LIMIT;
        contour.points.forEach((p, pi) => {
          if(overflow&&!remembered.has(p))return;
          const node = svgNode('circle', { cx:p.x, cy:p.y, r:radius, 'data-contour':ci, 'data-point':pi, class:`path-editor-point ${selected?.ci === ci && selected?.pi === pi ? 'selected' : ''}` });
          node.addEventListener('pointerdown', e => {
            if (e.button !== 0 || panMode || spaceHeld) return;
            dragBefore = snapshotDraft(current());
            e.preventDefault(); e.stopPropagation(); selected = {ci,pi}; dragging = {ci,pi,pointerId:e.pointerId};
            canvas.setPointerCapture(e.pointerId); canvas.focus(); renderCanvas(); syncStatus();
          });
          canvas.append(node);
        });
      }));
      if (!dragging) {
        const issues=validationOf(current()).issues||[], marked=new Set();
        for(const issue of issues) {
          for(const edge of issue.edges||[]) {
            const key=`${edge.contourIndex}:${edge.edgeIndex}`;if(marked.has(key))continue;marked.add(key);
            const contour=current().contours[edge.contourIndex],a=contour?.points[edge.edgeIndex],b=contour?.points[(edge.edgeIndex+1)%contour.points.length];
            if(a&&b)canvas.append(svgNode('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'path-editor-issue-edge','data-contour':edge.contourIndex,'data-edge':edge.edgeIndex,'vector-effect':'non-scaling-stroke'}));
          }
          for(const p of issue.points||[]) {
            const size=radius*1.8;
            canvas.append(svgNode('path',{d:`M${p.x-size} ${p.y-size}L${p.x+size} ${p.y+size}M${p.x-size} ${p.y+size}L${p.x+size} ${p.y-size}`,class:'path-editor-issue-point','vector-effect':'non-scaling-stroke'}));
          }
        }
      }
    }
    function syncStatus() {
      find('undo').disabled = !history.canUndo || !!dragging; find('redo').disabled = !history.canRedo || !!dragging;
      if (dragging) { find('import').disabled=true; find('status').textContent='頂点を移動中… 離すと輪郭を検証します。'; return; }
      const validation = validationOf(current());
      const enabled = drafts.filter(draft => draft.enabled);
      const invalid = enabled.filter(draft => !validationOf(draft).valid);
      find('status').textContent = `${validation.vertexCount} 頂点${current().contours.some(c => !c.closed) ? ' · 開いた輪郭あり' : ''}${validation.errors.length ? '\n'+validation.errors.join('\n') : ''}${validation.vertexCount>PATH_EDITOR_VERTEX_LIMIT ? '\n頂点を削減してください。交差箇所の赤い辺の端点は調整できます。' : ''}${notice ? '\n'+notice : ''}`;
      find('import').disabled = !enabled.length || invalid.length > 0;
      dialog.querySelector('.path-editor-summary').textContent = `${enabled.length} パスを${existing ? '編集' : '追加'}${invalid.length ? ` · ${invalid.length} パスの調整が必要です` : ''}`;
      find('delete-point').disabled = !selected;
      find('add-point').disabled = validation.vertexCount>PATH_EDITOR_VERTEX_LIMIT || !current().contours.some(c => c.points.length >= 2);
      find('close').disabled = !current().contours.some(c => !c.closed);
      find('reference-reset').hidden = !current().referenceShape;
      find('repair').disabled = validation.vertexCount>PATH_EDITOR_VERTEX_LIMIT;
      find('focus-issue').disabled = !(validation.issues||[]).some(issue=>issue.points?.length||issue.edges?.length);
    }
    function render() {
      list.replaceChildren();
      drafts.forEach((draft,index) => {
        const row = document.createElement('div'); row.className = `path-editor-row ${active === index ? 'active' : ''}`;
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = draft.enabled; check.setAttribute('aria-label', `${draft.name} を${existing ? '編集' : '追加'}`);
        check.addEventListener('change', () => { active=index; selected=null; mutate(() => { draft.enabled = check.checked; }); });
        const button = document.createElement('button'); button.type = 'button'; button.className = 'path-editor-select';
        const name = document.createElement('span'); name.textContent = draft.name;
        const layer = document.createElement('small'); layer.textContent = draft.layerName || 'レイヤーなし'; button.append(name,layer);
        button.addEventListener('click', () => { active=index; selected=null; notice=''; render(); }); row.append(check,button); list.append(row);
      });
      find('name').value = current().name;
      renderCanvas(); syncStatus();
    }
    function mutate(operation) {
      const before = snapshotDraft(current());
      notice='';
      try { operation(); } catch (error) { notice=error.message; }
      history.record(active, before, snapshotDraft(current()));
      validationCache.delete(current());
      render();
    }
    function nearest(p) {
      let best = null;
      current().contours.forEach((contour,ci) => {
        const count = contour.closed ? contour.points.length : contour.points.length - 1;
        for (let pi=0; pi<count; pi++) {
          const a=contour.points[pi],b=contour.points[(pi+1)%contour.points.length];
          const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
          const x=a.x+t*dx,y=a.y+t*dy,distance=Math.hypot(p.x-x,p.y-y);
          if (!best || distance<best.distance) best={ci,pi,x,y,distance};
        }
      }); return best;
    }
    function addAt(p) {
      if (current().contours.reduce((count,c)=>count+c.points.length,0)>PATH_EDITOR_VERTEX_LIMIT) return;
      const edge=nearest(p); if (!edge) return;
      mutate(() => { addDraftPoint(current(),edge.ci,edge.pi,edge.x,edge.y); selected={ci:edge.ci,pi:edge.pi+1}; });
    }
    function applyPendingPoint() {
      dragFrame=null;
      if (!dragging || !pendingPoint || finished) return;
      const p=pendingPoint; pendingPoint=null;
      moveDraftPoint(current(),dragging.ci,dragging.pi,p.x,p.y);
      validationCache.delete(current());
      const node=canvas.querySelector(`circle[data-contour="${dragging.ci}"][data-point="${dragging.pi}"]`);
      node?.setAttribute('cx',p.x); node?.setAttribute('cy',p.y);
      const contour=current().contours[dragging.ci];
      const outline=canvas.querySelector(`path[data-draft="${active}"][data-outline-contour="${dragging.ci}"]`);
      outline?.setAttribute('d',contour.points.map((point,index)=>`${index?'L':'M'}${point.x} ${point.y}`).join(' ')+(contour.closed?' Z':''));
    }
    canvas.addEventListener('pointerdown', e => {
      if (dragging || !(e.button === 1 || (e.button === 0 && (panMode || spaceHeld)))) return;
      e.preventDefault(); const p = point(e); if (!p) return;
      panning = { pointerId: e.pointerId, x: p.x, y: p.y };
      canvas.setPointerCapture(e.pointerId); canvas.focus(); canvas.classList.add('panning');
    });
    canvas.addEventListener('pointermove', e => {
      if (panning?.pointerId === e.pointerId) {
        const p = point(e); if (!p) return;
        view[0] += panning.x - p.x; view[1] += panning.y - p.y; canvas.setAttribute('viewBox', view.join(' ')); return;
      }
      if (!dragging || dragging.pointerId !== e.pointerId) return;
      pendingPoint=point(e);
      if (pendingPoint && dragFrame===null) dragFrame=requestAnimationFrame(applyPendingPoint);
    });
    const stopDrag = e => {
      if (panning && (e?.pointerId === undefined || e.pointerId === panning.pointerId)) { panning = null; canvas.classList.remove('panning'); }
      if (!dragging || (e?.pointerId !== undefined && e.pointerId !== dragging.pointerId)) return;
      if (dragFrame!==null) { cancelAnimationFrame(dragFrame); dragFrame=null; }
      applyPendingPoint();
      history.record(active, dragBefore, snapshotDraft(current())); dragBefore = null;
      dragging=null; pendingPoint=null;
      renderCanvas(); syncStatus();
    };
    canvas.addEventListener('pointerup',stopDrag); canvas.addEventListener('pointercancel',stopDrag);
    canvas.addEventListener('lostpointercapture',stopDrag);
    canvas.addEventListener('dblclick', e => { if (panMode || spaceHeld || e.target.hasAttribute('data-point')) return; const p=point(e); if(p) addAt(p); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); if (dragging || panning) return; const p=point(e); if(!p)return;
      const factor = e.deltaY > 0 ? 1.15 : 1/1.15;
      if (Math.max(view[2],view[3])*factor > 1e9 || Math.min(view[2],view[3])*factor < 1e-7) return;
      view=[p.x+(view[0]-p.x)*factor,p.y+(view[1]-p.y)*factor,view[2]*factor,view[3]*factor]; renderCanvas();
    },{passive:false});
    canvas.addEventListener('keydown', e => {
      if (!panning && !spaceHeld && (e.key==='Delete'||e.key==='Backspace') && selected) { e.preventDefault(); find('delete-point').click(); }
    });
    find('name').addEventListener('change', e => { const value=e.target.value; mutate(() => { current().name=value; }); });
    function travel(direction) {
      if (dragging || panning) return;
      const index=history[direction](drafts); if (index===null) return;
      active=index; selected=null; notice=''; validationCache.delete(current()); render();
    }
    find('undo').addEventListener('click', () => travel('undo'));
    find('redo').addEventListener('click', () => travel('redo'));
    find('pan').addEventListener('click', () => { panMode=!panMode; find('pan').setAttribute('aria-pressed', String(panMode)); canvas.classList.toggle('pan-mode',panMode); });
    find('close').addEventListener('click', () => mutate(() => closeDraft(current())));
    find('reference-reset').addEventListener('click',()=>mutate(()=>{resetReferenceDraft(current());selected=null;}));
    find('repair').addEventListener('click',()=>mutate(()=>{const result=repairDraft(current());notice=result.message;selected=null;}));
    find('focus-issue').addEventListener('click',()=>{
      const issues=(validationOf(current()).issues||[]).filter(issue=>issue.points?.length||issue.edges?.length);if(!issues.length)return;
      const issue=issues[issueCursor++%issues.length],points=[...(issue.points||[])];
      for(const edge of issue.edges||[]) {const c=current().contours[edge.contourIndex];const a=c?.points[edge.edgeIndex],b=c?.points[(edge.edgeIndex+1)%c.points.length];if(a&&b)points.push(a,b);}
      const finite=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(!finite.length)return;
      const minX=Math.min(...finite.map(p=>p.x)),maxX=Math.max(...finite.map(p=>p.x)),minY=Math.min(...finite.map(p=>p.y)),maxY=Math.max(...finite.map(p=>p.y));
      const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY),pad=Math.max(width,height)*.3;
      view=[minX-pad,minY-pad,width+pad*2,height+pad*2];notice=issue.message;renderCanvas();syncStatus();
    });
    find('reset').addEventListener('click', () => mutate(() => { resetDraft(current()); selected=null; }));
    find('reduce').addEventListener('click', () => mutate(() => { const tolerance=Number(find('tolerance').value); if(!Number.isFinite(tolerance)||tolerance<0)throw new Error('許容誤差は0以上の数値にしてください。'); const result=simplifyDraft(current(),tolerance); if(!result.applied && tolerance>0) throw new Error(result.errors.join('\n') || '形状を維持したまま削減できませんでした。許容誤差を変更してください。'); selected=null; }));
    find('delete-point').addEventListener('click', () => { if(selected) mutate(() => { if(!deleteDraftPoint(current(),selected.ci,selected.pi)) throw new Error('これ以上頂点を削除できません。閉じた輪郭には3頂点以上必要です。'); selected=null; }); });
    find('add-point').addEventListener('click', () => {
      const ci=selected?.ci ?? 0, pi=selected?.pi ?? 0, contour=current().contours[ci];
      const a=contour?.points[pi],b=contour?.points[(pi+1)%contour.points.length];
      if(a&&b) mutate(() => { const segment=!contour.closed && pi===contour.points.length-1 ? pi-1 : pi; const from=contour.points[segment],to=contour.points[(segment+1)%contour.points.length]; addDraftPoint(current(),ci,segment,(from.x+to.x)/2,(from.y+to.y)/2); selected={ci,pi:segment+1}; });
    });
    find('fit').addEventListener('click', () => { fit(); renderCanvas(); });
    find('cancel').addEventListener('click', () => finish(null));
    dialog.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.target.matches('input,textarea,[contenteditable=true]')) return;
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase()==='z' || e.key.toLowerCase()==='y')) { e.preventDefault(); travel(e.key.toLowerCase()==='y' || e.shiftKey ? 'redo' : 'undo'); }
      if (e.code==='Space') { e.preventDefault(); spaceHeld=true; canvas.classList.add('pan-mode'); }
    });
    dialog.addEventListener('keyup', e => { e.stopPropagation(); if (e.code==='Space') { spaceHeld=false; canvas.classList.toggle('pan-mode',panMode); } });
    dialog.addEventListener('focusout', e => { if (!dialog.contains(e.relatedTarget)) { spaceHeld=false; canvas.classList.toggle('pan-mode',panMode); } });
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    find('import').addEventListener('click', () => {
      const enabled=drafts.filter(draft => draft.enabled);
      if (!enabled.length || enabled.some(draft => !validationOf(draft).valid)) return;
      try { finish({objects:enabled.map(toImportEntry), warnings}); } catch(error) { notice=error.message; syncStatus(); }
    });
    dialog.showModal(); if(!view)fit(); render(); canvas.focus();
  });
}
