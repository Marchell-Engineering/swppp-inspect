// The page a report email links to (Brandon, 10/22: ComplianceGo let the email's readers tick items off with no
// account or app; 11/16: "can you add the interactive history/calendar to the email?"). The link's code (?t=) picks
// the site. The page lists its open items as of now, and the reader marks one fixed with their name, a note and a
// photo if they like. That flags the item for the next inspection to confirm on site; it doesn't close it (Brandon's
// pick, Att. D II.J.2). Under them, the site's History calendar and its Reports / Action items lists, drawn by the
// app's own code (js/history.js), read-only: no Get the PDF (the script hands a PDF only to an inspector's code),
// no Correct. It talks to the Google script the same way the app does (gas/Code.gs fixList / fixMark).

import { BACKEND_URL } from './settings.js';
import { h } from './dom.js';
import { historyView, reportRow } from './history.js';

const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const backend = (local && params.get('backend')) || BACKEND_URL;
const $app = document.getElementById('app');
const $title = document.getElementById('title');

async function call(payload) {
  const r = await fetch(backend, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`The server said ${r.status}. Try again in a minute.`);
  const out = await r.json();
  if (!out.ok) throw new Error(out.error || 'The server refused.');
  return out;
}

const mdy = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
const when = (ms) => new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

// the reader's name, kept on this phone or computer for next time (fine if the browser won't keep it)
const savedName = () => { try { return localStorage.getItem('swppp_fix_name') || ''; } catch { return ''; } };
const saveName = (n) => { try { localStorage.setItem('swppp_fix_name', n); } catch { /* not kept */ } };

// a phone photo shrunk to 1600 px on its long side, as base64 JPEG
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a photo.')); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

let nameInput;
let hist = null;     // { items, view } once the history has drawn

const siteToday = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const savedTab = () => { try { return localStorage.getItem('swppp_fix_tab') || 'items'; } catch { return 'items'; } };
const saveTab = (t) => { try { localStorage.setItem('swppp_fix_tab', t); } catch { /* not kept */ } };

function itemCard(x) {
  const head = [
    h('div', { class: 'row' }, h('span', { class: 't grow', style: 'font-weight:700' }, x.title)),
    h('div', { class: 'sub' }, `Opened ${mdy(x.date)}${x.due ? ` · fix by ${mdy(x.due)}` : ''}`),
    x.description ? h('p', { style: 'margin:6px 0' }, x.description) : null,
    x.location ? h('div', { class: 'sub' }, x.location) : null,
  ];
  if (x.reported) {
    return h('div', { class: 'card', id: 'item-' + x.id }, ...head,
      h('div', { class: 'banner green', style: 'margin:10px 0 0' },
        h('strong', {}, `Marked fixed by ${x.reported.by}, ${when(x.reported.at)}.`),
        x.reported.note ? ` "${x.reported.note}"` : '',
        ' The inspector confirms it at the next inspection.'));
  }
  const note = h('textarea', { placeholder: 'What was done (optional)' });
  const photo = h('input', { type: 'file', accept: 'image/*' });
  const msg = h('p', { class: 'hint' });
  const btn = h('button', { class: 'btn primary block' }, 'Mark fixed');
  btn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      msg.textContent = 'Add your name at the top first.';
      nameInput.focus();
      return;
    }
    saveName(name);
    btn.disabled = true;
    btn.textContent = 'Sending…';
    msg.textContent = '';
    try {
      const pic = photo.files && photo.files[0] ? await shrink(photo.files[0]) : '';
      const out = await call({ action: 'fix_mark', token, item_id: x.id, name, note: note.value, photo: pic });
      document.getElementById('item-' + x.id).replaceWith(itemCard({ ...x, reported: out.reported }));
      const logged = hist && hist.items.find((it) => it.id === x.id);
      if (logged) { logged.reported = out.reported; hist.view.repaint(); }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Mark fixed';
      msg.textContent = `Not sent: ${e.message}`;
      msg.style.color = 'var(--red)';
    }
  });
  return h('div', { class: 'card', id: 'item-' + x.id }, ...head,
    h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, 'Note', h('span', { class: 'opt' }, ' (optional)')), note),
    h('div', { class: 'field' }, h('label', {}, 'Photo of the fix', h('span', { class: 'opt' }, ' (optional)')), photo),
    btn, msg);
}

// the site's History calendar and lists, when the script sends them (one pushed before 11/16 sends open items only)
function historyCards(out) {
  if (!Array.isArray(out.history)) return [];
  const items = Array.isArray(out.items_all) ? out.items_all : undefined;
  const view = historyView({
    rows: out.history, items, today: siteToday(out.site.tz), tab: savedTab(), onTab: saveTab,
    row: (r) => reportRow(r),
    hints: { empty: 'No reports on file here yet.' },
  });
  hist = { items: items || [], view };
  return [
    h('div', { class: 'card' },
      h('h2', {}, 'Inspection history'),
      h('p', { class: 'hint', style: 'margin-top:0' }, 'Tap a day to see what happened on it. The arrows step back through earlier months.'),
      view.cal),
    h('div', { class: 'card' }, view.list),
  ];
}

async function load() {
  if (!token) {
    $app.replaceChildren(h('div', { class: 'banner red' }, 'This link is missing its code. Use the link in the report email.'));
    return;
  }
  try {
    const out = await call({ action: 'fix_list', token });
    $title.textContent = out.site.name;
    document.title = `SWPPP - ${out.site.name}`;
    nameInput = h('input', { type: 'text', autocomplete: 'name', placeholder: 'First and last name', value: savedName() });
    const kids = [
      h('div', { class: 'card' },
        h('h2', {}, 'Open SWPPP action items'),
        h('p', { class: 'sub', style: 'margin-top:0' }, out.site.address || ''),
        out.items.length ? h('p', { class: 'hint' }, 'Mark an item fixed once the work is done. Marchell Engineering\'s inspector checks it on site at the next inspection and closes it then.') : null,
        out.items.length ? h('div', { class: 'field' }, h('label', {}, 'Your name'), nameInput) : null),
    ];
    if (!out.items.length) kids.push(h('div', { class: 'banner green' }, 'No open action items right now. Thank you!'));
    for (const x of out.items) kids.push(itemCard(x));
    kids.push(...historyCards(out));
    $app.replaceChildren(...kids);
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'banner red' }, e.message.includes('Failed to fetch') ? 'No connection. Try again once you have signal.' : e.message));
  }
}

load();
