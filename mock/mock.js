'use strict';
/* Отрисовка макета. Состояние живёт в памяти: правки на странице работают, перезагрузка
   или «Сбросить макет» возвращает вымышленные данные. Никаких запросов к серверу. */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = v => (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ru-RU');
const fmtDate = d => d.slice(8) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
const stage = code => STATUSES.find(s => s.code === code) || STATUSES[0];

let rows = [];
const F = { status: '', text: '' };

function reset() { rows = SEED.map(r => Object.assign({}, r)); render(); }

function filtered() {
  return rows.filter(r => (!F.status || r.status === F.status) &&
    (!F.text || r.title.toLowerCase().indexOf(F.text.toLowerCase()) >= 0));
}

function render() {
  const list = filtered();
  const total = list.reduce((s, r) => s + r.amount, 0);
  $('kpis').innerHTML =
    '<div class="kpi"><div class="lbl">Записей</div><div class="val">' + list.length + '</div></div>' +
    '<div class="kpi"><div class="lbl">Итого</div><div class="val ' + (total < 0 ? 'neg' : 'pos') + '">' + fmt(total) + '</div><div class="sub">₽</div></div>';
  $('list').innerHTML = list.length
    ? '<table><thead><tr><th>Название</th><th>Дата</th><th class="num">Сумма</th><th>Статус</th></tr></thead><tbody>' +
      list.map(r => '<tr><td>' + esc(r.title) + '</td><td>' + fmtDate(r.date) + '</td><td class="num ' + (r.amount < 0 ? 'neg' : 'pos') + '">' + fmt(r.amount) +
        '</td><td><span class="stage-badge" style="background:' + stage(r.status).color + '">' + esc(stage(r.status).name) + '</span></td></tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">Нет данных по выбранным фильтрам.</p>';
}

function init() {
  $('fStatus').innerHTML += STATUSES.map(s => '<option value="' + s.code + '">' + esc(s.name) + '</option>').join('');
  $('fStatus').onchange = e => { F.status = e.target.value; render(); };
  $('fText').oninput = e => { F.text = e.target.value; render(); };
  $('resetBtn').onclick = reset;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + b.dataset.tab));
  });
  // Окно «Дебаг» (в приложении — только админам): показать текст и скопировать его в буфер.
  const out = $('debug-output'), st = $('debug-status');
  $('debug-btn').onclick = () => { out.value = DEBUG_SAMPLE; st.textContent = ''; $('debug-modal-overlay').hidden = false; };
  $('debug-modal-close').onclick = () => { $('debug-modal-overlay').hidden = true; };
  $('debug-modal-copy').onclick = () => {
    const fb = () => { out.select(); st.textContent = document.execCommand('copy') ? 'Скопировано в буфер обмена' : 'Выдели текст и нажми Ctrl+C'; };
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(out.value).then(() => { st.textContent = 'Скопировано в буфер обмена'; }, fb) : fb();
  };
  reset();
}
init();
