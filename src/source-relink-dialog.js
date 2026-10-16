import './source-relink-dialog.css';

/** Ask how changed source paths should replace existing objects; cancellation mutates nothing. */
export function resolveSourceRelink(existing, incoming, plan = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'source-relink-dialog';
    dialog.className = 'source-relink-dialog';
    dialog.setAttribute('aria-labelledby', 'source-relink-title');
    dialog.innerHTML = `<header><strong id="source-relink-title">参照パスの再リンク</strong><button id="source-relink-cancel" type="button">キャンセル</button></header><p class="source-relink-warning">レイヤー・パス構造が変わっています。対応するパスを選んでください。リンクしたオブジェクトのパラメータは維持されます。</p><div class="source-relink-columns"><section><h3>読み込み済みのパス → 新しいパス</h3><div class="source-relink-existing"></div></section><section><h3>新しいファイルのパス</h3><p>リンクされていないパスは「追加」を選べます。</p><div class="source-relink-incoming"></div></section></div><footer><span id="source-relink-status" role="status" aria-live="polite"></span><button id="source-relink-apply" type="button">再読み込みを適用</button></footer>`;
    const existingList = dialog.querySelector('.source-relink-existing');
    const incomingList = dialog.querySelector('.source-relink-incoming');
    const apply = dialog.querySelector('#source-relink-apply');
    const status = dialog.querySelector('#source-relink-status');
    const selects = [], checks = [];
    const title = (item, index) => `${item.layerName ? `${item.layerName} / ` : ''}${item.name || `パス ${index + 1}`}`;
    const option = (select, value, text) => { const node = document.createElement('option'); node.value = value; node.textContent = text; select.append(node); };
    existing.forEach((item, index) => {
      const row = document.createElement('label'); row.className = 'source-relink-row';
      const name = document.createElement('span'); name.textContent = title(item, index); row.append(name);
      const select = document.createElement('select'); select.className = 'source-relink-mapping'; select.dataset.objectId = item.id;
      select.setAttribute('aria-label', `${title(item, index)} のリンク先`);
      option(select, 'keep', 'リンクせず現在の形状を維持');
      option(select, 'remove', 'このオブジェクトを削除');
      incoming.forEach((entry, n) => option(select, `incoming:${n}`, title(entry, n)));
      const match = (plan.matches || plan.links || []).find((entry) => entry.objectId === item.id);
      if (match && Number.isInteger(match.incomingIndex) && incoming[match.incomingIndex]) select.value = `incoming:${match.incomingIndex}`;
      row.append(select); existingList.append(row); selects.push(select);
    });
    incoming.forEach((item, index) => {
      const row = document.createElement('label'); row.className = 'source-relink-row source-relink-new-row';
      const name = document.createElement('span'); name.textContent = title(item, index);
      const controls = document.createElement('span'); controls.className = 'source-relink-choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'source-relink-add'; checkbox.dataset.incomingIndex = String(index); checkbox.checked = true;
      checkbox.setAttribute('aria-label', `${title(item, index)} を追加`);
      const description = document.createElement('span');
      controls.append(checkbox, description); row.append(name, controls); incomingList.append(row); checks.push({ checkbox, description });
    });
    function update() {
      const linked = selects.filter((select) => select.value.startsWith('incoming:')).map((select) => Number(select.value.slice(9)));
      const duplicates = new Set(linked).size !== linked.length;
      checks.forEach(({ checkbox, description }, index) => {
        const used = linked.includes(index); checkbox.disabled = used; checkbox.hidden = used;
        description.textContent = used ? 'リンク済み' : '追加';
      });
      apply.disabled = duplicates;
      status.textContent = duplicates ? '同じ新しいパスに複数のオブジェクトがリンクされています。リンク先を変更してください。' : 'リンクしない既存パスは、削除を選ばない限り維持されます。';
    }
    let settled = false;
    function finish(value) { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); }
    dialog.querySelector('#source-relink-cancel').addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.addEventListener('keyup', (event) => event.stopPropagation());
    dialog.addEventListener('change', update);
    apply.addEventListener('click', () => {
      if (apply.disabled) return;
      const links = [], removeIds = [];
      selects.forEach((select) => {
        if (select.value === 'remove') removeIds.push(select.dataset.objectId);
        else if (select.value.startsWith('incoming:')) links.push({ objectId: select.dataset.objectId, incomingIndex: Number(select.value.slice(9)) });
      });
      const linked = new Set(links.map((link) => link.incomingIndex));
      const addIndices = checks.flatMap(({ checkbox }, index) => checkbox.checked && !linked.has(index) ? [index] : []);
      finish({ links, addIndices, removeIds });
    });
    document.body.append(dialog); update(); dialog.showModal();
  });
}
