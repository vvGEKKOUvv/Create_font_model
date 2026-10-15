import { createPreset, serializePresetLibrary, parsePresetLibrary } from './parameter-presets.js';

const STORAGE_KEY = 'pathform.parameterPresets.v1';
export function createPresetPanel({ container, getObject, flush, onApply, onNotice }) {
  container.innerHTML = `<summary>パラメータプリセット <span>PRESET</span></summary><div class="preset-controls"><label>名前<input id="preset-name" type="text" maxlength="120" placeholder="プリセット名"/></label><button id="preset-save" class="subtle">現在の設定を保存</button><select id="preset-list" aria-label="パラメータプリセット"></select><div class="preset-actions"><button id="preset-apply" class="subtle">選択中に適用</button><button id="preset-delete" class="subtle">削除</button></div><div class="preset-actions"><button id="preset-export" class="subtle">書き出し</button><button id="preset-open" class="subtle">読み込み</button></div><input id="preset-import" type="file" accept=".pathform-presets,.json,application/json" hidden/><p class="control-note">形状・ベベルカーブ・UV・マテリアルを保存</p><p id="preset-status" role="status"></p></div>`;
  const $ = id => container.querySelector(`#preset-${id}`);
  let presets = [], selected = '', storageNote = '';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) presets = parsePresetLibrary(stored);
  } catch {
    storageNote = 'ブラウザー保存を利用できません。プリセットはファイルへ書き出してください。';
  }
  function message(text, error = false) {
    $('status').textContent = [text, storageNote].filter(Boolean).join(' ');
    $('status').classList.toggle('error', error);
    if (text) onNotice(text, error);
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, serializePresetLibrary(presets)); storageNote = ''; }
    catch { storageNote = 'ブラウザーへの保存に失敗しました。ファイルへ書き出してください。'; }
  }
  function sync() {
    $('save').disabled = !getObject() || getObject().invalid === true;
    $('apply').disabled = !getObject() || !presets.some(p => p.id === selected);
    $('delete').disabled = !presets.some(p => p.id === selected);
    $('export').disabled = !presets.length;
    $('list').disabled = !presets.length;
  }
  function render() {
    if (!presets.some(p => p.id === selected)) selected = presets[0]?.id ?? '';
    $('list').replaceChildren();
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id; option.textContent = preset.name; $('list').append(option);
    }
    $('list').value = selected; sync();
  }
  $('list').onchange = () => { selected = $('list').value; sync(); };
  $('save').onclick = () => {
    try {
      if (!flush()) throw new Error('生成できない設定を修正してから保存してください。');
      const object = getObject(); if (!object) return;
      if (object.invalid) throw new Error('生成できない設定を修正してから保存してください。');
      const base = $('name').value.trim() || object.name || 'プリセット';
      let name = base, n = 2;
      while (presets.some(p => p.name === name)) name = `${base.slice(0, 112)} ${n++}`;
      const preset = createPreset(name, object), next = [...presets, preset];
      serializePresetLibrary(next); presets = next; selected = preset.id;
      persist(); render(); message(`「${preset.name}」を保存しました。`);
    } catch (error) { message(error.message, true); }
  };
  $('apply').onclick = () => {
    try {
      const preset = presets.find(p => p.id === selected); if (!preset) return;
      const result = onApply(preset);
      message(`${result.count} 個のオブジェクトに適用しました。${result.warnings?.length ? ' '+result.warnings.join(' / ') : ''}`);
    } catch (error) { message(error.message, true); }
  };
  $('delete').onclick = () => {
    const preset = presets.find(p => p.id === selected); if (!preset) return;
    presets = presets.filter(p => p.id !== selected); selected = ''; persist(); render(); message(`「${preset.name}」を削除しました。`);
  };
  $('export').onclick = () => {
    try {
      const blob = new Blob([serializePresetLibrary(presets)], {type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'parameters.pathform-presets'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); message('プリセットを書き出しました。');
    } catch (error) { message(error.message, true); }
  };
  $('open').onclick = () => $('import').click();
  $('import').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 1024*1024) throw new Error('プリセットファイルは1 MB以下にしてください。');
      const imported = parsePresetLibrary(await file.text()), next = presets.slice();
      let count = 0;
      for (const preset of imported) {
        const match = next.find(p => p.id === preset.id);
        if (match && JSON.stringify(match) === JSON.stringify(preset)) continue;
        const incoming = match ? createPreset(preset.name, preset) : preset;
        const base = incoming.name; let name = base, n = 2;
        while (next.some(p => p.name === name)) name = `${base.slice(0,112)} ${n++}`;
        next.push({...incoming,name}); count++;
      }
      serializePresetLibrary(next); presets = next;
      if (count) selected = presets.at(-1).id;
      persist(); render(); message(`${count} 件のプリセットを追加しました。`);
    } catch (error) { message(error.message, true); }
  };
  render(); message('');
  return { sync };
}
