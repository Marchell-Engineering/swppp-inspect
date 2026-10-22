// SWPPP Inspect: the screens. Sign in -> sites -> the inspection form -> sign -> PDF -> upload queue.
// Everything is saved on the phone as it is typed; nothing needs signal until the upload.

import { kv, reports, blobs, persist, uid } from './store.js';
import { signIn, refreshConfig, flushQueue, net } from './api.js';
import { fetchForecast, fetchGauges, lastRain, classify, whatsDue, mergeSeen, unionSeen, typeReasons, localDate, fmtLocal } from './weather.js';
import { SECTIONS, ALL_QUESTIONS, TYPES, PHASES, PRIORITY_DAYS, NAL } from './checklist.js';
import { shrinkPhoto, photoDataUrl, blobToDataUrl, where, SigPad } from './media.js';
import { buildPdf } from './pdf.js';
import { APP_VERSION } from './settings.js';

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $jump = document.getElementById('jump');
const $net = document.getElementById('net');
const $toast = document.getElementById('toast');
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const HOUR = 3600e3;

let view = { name: 'boot' };
let cur = null;          // the open inspection: { rec, R, site }
let saveTimer = null;
let swWaiting = null;
const uploadNote = {};   // report id -> latest upload message

// ---------------------------------------------------------------------------------------------
// tiny DOM helper

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function toast(text, ms = 2600) {
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
}

function netBadge() {
  const off = !navigator.onLine;
  const weak = !off && net.fail_ms > net.ok_ms;
  $net.textContent = off ? 'No signal' : weak ? 'Weak signal' : 'Online';
  $net.className = 'top-net' + (off ? ' off' : weak ? ' weak' : '');
}

const shortDate = (ms, tz) => fmtLocal(ms, tz, { weekday: 'short', hour: undefined, minute: undefined });
const shortTime = (ms, tz) => fmtLocal(ms, tz, { weekday: undefined, month: undefined, day: undefined });
const mdy = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------------------------
// navigation (the phone's back button works through history)

function go(v, replace = false) {
  view = v;
  if (replace) history.replaceState(v, '');
  else history.pushState(v, '');
  render();
}

window.addEventListener('popstate', (e) => {
  if (cur) saveNow();
  view = e.state || { name: 'home' };
  render();
});

async function render() {
  window.scrollTo(0, 0);
  $jump.hidden = true;
  $back.hidden = true;
  if (view.name === 'signin') return renderSignIn();
  if (view.name === 'home') return renderHome();
  if (view.name === 'inspect') return renderInspect(view.id);
  if (view.name === 'done') return renderDone(view.id);
}

$back.addEventListener('click', () => history.back());

// ---------------------------------------------------------------------------------------------
// sign in

function renderSignIn(error) {
  cur = null;
  $title.textContent = 'SWPPP Inspect';
  const input = h('input', { type: 'password', autocomplete: 'off', inputmode: 'text', placeholder: 'Inspector code' });
  const btn = h('button', { class: 'btn primary block big' }, 'Sign in');
  const msg = h('p', { class: 'hint' }, error || 'Enter the code Brandon gave you. You only do this once on this phone.');
  btn.addEventListener('click', async () => {
    if (!input.value.trim()) return;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signIn(input.value);
      go({ name: 'home' }, true);
      prefetchWeather();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      msg.textContent = navigator.onLine ? `That didn't work: ${e.message}` : 'Signing in needs signal. Try again once you have some.';
      msg.style.color = 'var(--red)';
    }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  $app.replaceChildren(h('div', { class: 'signin' },
    h('img', { src: 'img/logo.png', alt: 'Marchell Engineering' }),
    h('div', { class: 'card' }, h('h2', {}, 'SWPPP inspections'), input, h('div', { style: 'height:10px' }), btn, msg),
  ));
}

// ---------------------------------------------------------------------------------------------
// home: the sites, anything waiting to upload, recent reports

async function renderHome() {
  cur = null;
  const cfg = await kv.get('config');
  if (!cfg) return go({ name: 'signin' }, true);
  $title.textContent = 'SWPPP Inspect';
  const all = (await reports.all()).sort((a, b) => b.created_ms - a.created_ms);
  const waiting = all.filter((r) => r.status === 'signed');
  const drafts = all.filter((r) => r.status === 'draft');
  const done = all.filter((r) => r.status !== 'draft').slice(0, 12);
  const out = [];

  if (swWaiting) {
    out.push(h('div', { class: 'banner blue row' }, h('span', { class: 'grow' }, 'A new version of the app is ready.'),
      h('button', { class: 'btn sm primary', onclick: () => swWaiting.postMessage('skipWaiting') }, 'Update')));
  }
  if (waiting.length) {
    const note = waiting.map((r) => uploadNote[r.id]).filter(Boolean)[0];
    out.push(h('div', { class: 'banner amber' },
      h('div', { class: 'row' },
        h('strong', { class: 'grow' }, `${waiting.length} report${waiting.length > 1 ? 's' : ''} waiting to upload`),
        h('button', { class: 'btn sm', onclick: () => flush(true) }, 'Upload now')),
      h('div', { class: 'small' }, note || 'They go up on their own once the phone has signal. Open the app when you have bars.')));
  }

  if (drafts.length) {
    out.push(h('div', { class: 'card' }, h('h2', {}, 'In progress'),
      h('ul', { class: 'list' }, drafts.map((r) => {
        const del = h('button', { class: 'btn sm ghost danger' }, 'Delete');
        del.addEventListener('click', async () => {
          if (del.dataset.armed) {
            await deleteReport(r);
            renderHome();
          } else {
            del.dataset.armed = '1';
            del.textContent = 'Tap again to delete';
          }
        });
        return h('li', {},
          h('div', { class: 'grow' }, h('div', { style: 'font-weight:650' }, r.data.site.name),
            h('div', { class: 'sub' }, `Started ${fmtLocal(r.data.started_ms, r.data.tz)}`)),
          del,
          h('button', { class: 'btn sm primary', onclick: () => go({ name: 'inspect', id: r.id }) }, 'Resume'));
      }))));
  }

  for (const site of cfg.sites) {
    const wx = await kv.get('wx:' + site.id);
    const chips = [];
    const open = site.open_items || [];
    const today = localDate(Date.now(), site.tz || 'America/Los_Angeles');
    const late = open.filter((x) => x.due && x.due < today).length;
    if (site.trial) chips.push(h('span', { class: 'chip blue' }, 'Trial: ComplianceGo is still the record'));
    if (site.last && site.last.date) chips.push(h('span', { class: 'chip' }, `Last: ${mdy(site.last.date)} ${site.last.inspector || ''}`));
    if (open.length) chips.push(h('span', { class: 'chip ' + (late ? 'red' : 'amber') }, `${open.length} open item${open.length > 1 ? 's' : ''}${late ? `, ${late} late` : ''}`));
    if (wx && wx.forecast) {
      const f = wx.forecast;
      const age = Math.round((Date.now() - wx.forecast.fetched_ms) / HOUR);
      if (f.qpes.length) chips.push(h('span', { class: 'chip red' }, `QPE ${shortDate(f.qpes[0].start_ms, f.tz)}, ${f.qpes[0].total.toFixed(2)}"`));
      else chips.push(h('span', { class: 'chip ' + (f.status === 'rain' ? 'amber' : 'green') }, f.status === 'rain' ? 'Rain in forecast' : 'Dry forecast'));
      if (age >= 3) chips.push(h('span', { class: 'chip' }, `weather ${age} h old`));
    }
    const due = whatsDue(Date.now(), wx && wx.forecast, await kv.get('seen:' + site.id), site.last, site.tz || 'America/Los_Angeles');
    out.push(h('div', { class: 'card site' },
      h('div', { class: 'name' }, site.name),
      h('div', { class: 'meta' }, [site.address, site.wdid ? `WDID ${site.wdid}` : '', site.risk_level ? `Risk Level ${site.risk_level}` : ''].filter(Boolean).join(' · ')),
      h('ul', { class: 'due' }, due.map((d) => h('li', { class: d.urgent ? 'urgent' : '' }, d.text,
        d.qsp && cfg.inspector.role !== 'qsp' ? h('span', { class: 'sub' }, ' (a QSP does this one)') : null))),
      h('div', { class: 'chips' }, chips),
      h('button', { class: 'btn primary block', onclick: () => startInspection(site) }, 'Start inspection')));
  }

  if (done.length) {
    out.push(h('div', { class: 'card' }, h('h2', {}, 'Reports on this phone'),
      h('ul', { class: 'list' }, done.map((r) => h('li', {},
        h('div', { class: 'grow' }, h('div', { style: 'font-weight:650' }, `${r.data.site.name}`),
          h('div', { class: 'sub' }, `${mdy(r.data.date)} · ${r.data.types.map((t) => TYPES.find((x) => x.id === t).label).join(', ')}`)),
        h('span', { class: 'chip ' + (r.status === 'filed' ? 'green' : 'amber') }, r.status === 'filed' ? 'Filed' : 'Waiting'),
        h('button', { class: 'btn sm', onclick: () => go({ name: 'done', id: r.id }) }, 'Open'))))));
  }

  const signOut = h('button', { class: 'btn sm ghost' }, 'Sign out');
  signOut.addEventListener('click', async () => {
    if (waiting.length) return toast('Upload the waiting reports before signing out.');
    if (!signOut.dataset.armed) {
      signOut.dataset.armed = '1';
      signOut.textContent = 'Tap again to sign out';
      return;
    }
    await kv.del('code');
    await kv.del('config');
    go({ name: 'signin' }, true);
  });
  out.push(h('p', { class: 'hint', style: 'text-align:center' },
    `Signed in as ${cfg.inspector.name}, ${cfg.inspector.title} · v${APP_VERSION} `, signOut));
  $app.replaceChildren(...out);
}

// Refresh the site list, sending this phone's storms and taking everyone else's back.
async function syncConfig() {
  const cfg = await kv.get('config');
  const seen = {};
  for (const site of (cfg && cfg.sites) || []) seen[site.id] = (await kv.get('seen:' + site.id)) || [];
  const out = await refreshConfig(seen);
  if (out) for (const site of out.sites) await kv.set('seen:' + site.id, unionSeen(seen[site.id], site.qpes || []));
  return out;
}

async function deleteReport(r) {
  for (const p of r.data.photos) await blobs.del(`photo:${r.id}:${p.id}`);
  await blobs.del(`sig:${r.id}`);
  await blobs.del(`pdf:${r.id}`);
  await reports.del(r.id);
}

// Pull the forecast and the gauges for every site while there's signal, so a site with none still has them.
async function prefetchWeather() {
  const cfg = await kv.get('config');
  if (!cfg || !navigator.onLine) return;
  let changed = false;
  for (const site of cfg.sites) {
    const old = await kv.get('wx:' + site.id);
    if (old && old.forecast && Date.now() - old.forecast.fetched_ms < 45 * 60e3) continue;
    const wx = await pullWeather(site).catch(() => null);
    if (wx && wx.forecast) changed = true;
  }
  if (changed && view.name === 'home') renderHome();
}

async function pullWeather(site, timeoutMs = 20000) {
  const tz = site.tz || 'America/Los_Angeles';
  const now = Date.now();
  const limit = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), timeoutMs))]);
  const [forecast, gauges] = await Promise.all([
    limit(fetchForecast(site, now)).catch(() => null),
    limit(fetchGauges(site, now, tz)).catch(() => null),
  ]);
  if (forecast || gauges) net.ok_ms = Date.now();
  else net.fail_ms = Date.now();
  netBadge();
  const old = (await kv.get('wx:' + site.id)) || {};
  const wx = { forecast: forecast || old.forecast || null, gauges: gauges || old.gauges || null };
  await kv.set('wx:' + site.id, wx);
  if (forecast) {
    // remember every QPE seen forecast, for the post-QPE call after it drops off the forecast
    await kv.set('seen:' + site.id, mergeSeen(await kv.get('seen:' + site.id), forecast.fetched_ms, forecast.qpes));
  }
  return { ...wx, fresh: !!forecast };
}

// ---------------------------------------------------------------------------------------------
// starting an inspection

async function startInspection(site) {
  const cfg = await kv.get('config');
  const now = Date.now();
  const tz = site.tz || 'America/Los_Angeles';
  const id = uid();
  const last = site.last || {};
  const R = {
    id,
    app_version: APP_VERSION,
    tz,
    site: {
      id: site.id, name: site.name, address: site.address, wdid: site.wdid, risk_level: site.risk_level,
      permit: site.permit || {}, lat: site.lat, lon: site.lon,
    },
    inspector: { ...cfg.inspector },
    started_ms: now,
    finished_ms: null,
    date: localDate(now, tz),
    gps: null,
    types: ['weekly'],
    types_touched: false,
    storm_gauge_in: '',
    forecast_checked: false,
    weather: { forecast: null, gauges: null, note: 'Pulling the forecast…' },
    answers: Object.fromEntries((last.na || []).filter((id) => ALL_QUESTIONS.some((q) => q.id === id && q.options.includes('na'))).map((id) => [id, 'na'])),
    na_from_last: (last.na || []).slice(),
    notes: {},
    site_info: {
      phase: last.phase || '', activities: last.activities || '', area: last.area || '', completed: '',
      weather_today: '', gauge_in: '', event: 'N/A', comments: '',
    },
    carried: (site.open_items || []).map((x) => ({ ...x, status: null, closed_on: '', close_note: '' })),
    items: [],
    photos: [],
    sampling: null,
    signature: null,
  };
  const rec = { id, site_id: site.id, status: 'draft', created_ms: now, updated_ms: now, data: R, files: [], meta: { pdf_name: site.pdf_name } };
  await reports.put(rec);
  go({ name: 'inspect', id });
  where().then((g) => {
    if (g && cur && cur.R.id === id) {
      cur.R.gps = g;
      save();
    }
  });
}

async function loadWeather(force) {
  const { R, site } = cur;
  const cached = await kv.get('wx:' + site.id);
  let wx = cached;
  const stale = !cached || !cached.forecast || Date.now() - cached.forecast.fetched_ms > HOUR;
  if (force || stale) {
    paintWeather('Pulling the forecast…');
    if (navigator.onLine) wx = await pullWeather(site, 15000).catch(() => cached);
  }
  if (!cur || cur.R !== R) return;
  applyWeather(wx);
}

function applyWeather(wx) {
  const { R, site } = cur;
  const f = wx && wx.forecast;
  const g = wx && wx.gauges;
  const note = !f
    ? 'No signal, and no saved forecast for this site on this phone. Tap "Try again" once you have bars, or note the forecast in comments.'
    : Date.now() - f.fetched_ms > HOUR
      ? `Saved forecast from ${fmtLocal(f.fetched_ms, R.tz)} (no fresh pull on site).`
      : '';
  let last24 = null;
  const nearest = g && g.gauges.find((x) => x.days.some((d) => d.in !== null));
  if (nearest) {
    const d = [...nearest.days].reverse().find((x) => x.in !== null);
    last24 = { in: d.in, date: d.date, gauge: nearest.name };
  }
  R.weather = { forecast: f || null, gauges: g || null, last_rain: g ? lastRain(g.gauges) : null, last24, note };
  R.forecast_checked = !!f;
  if (f) {
    if (!R.site_info.weather_today && f.current) R.site_info.weather_today = `${f.current.temp}°${f.current.unit}, ${f.current.short}`;
    const during = f.qpes.find((q) => q.start_ms <= Date.now() && Date.now() < q.end_ms);
    if (during && (!R.site_info.event || R.site_info.event === 'N/A')) {
      R.site_info.event = `QPE forecast ${fmtLocal(during.start_ms, R.tz)} to ${fmtLocal(during.end_ms, R.tz)}`;
    }
  }
  kv.get('seen:' + site.id).then((seen) => {
    if (!cur || cur.R !== R) return;
    cur.seen = seen || [];
    reclassify();
    save();
    repaint(['wx', 'type', 'general', 'site']);
  });
}

// ---------------------------------------------------------------------------------------------
// the inspection form

async function renderInspect(id) {
  const rec = await reports.get(id);
  if (!rec) return go({ name: 'home' }, true);
  if (rec.status !== 'draft') return go({ name: 'done', id }, true);
  const cfg = await kv.get('config');
  const site = cfg.sites.find((s) => s.id === rec.site_id) || rec.data.site;
  cur = { rec, R: rec.data, site, pad: null };
  $title.textContent = rec.data.site.name;
  $back.hidden = false;
  $app.replaceChildren(...cards().map((c) => c.build()));
  paintJump();
  if (!rec.data.weather.forecast || Date.now() - rec.data.started_ms < 5 * 60e3) loadWeather(false);
}

// each card: id, jump label, build(), status() -> 'done' | 'warn' | ''
function cards() {
  const { R } = cur;
  const list = [
    { id: 'wx', label: 'Weather', build: weatherCard, status: () => (R.weather.forecast ? 'done' : '') },
    { id: 'type', label: 'Type', build: typeCard, status: () => (R.types.length ? 'done' : 'warn') },
  ];
  if (R.carried.length) list.push({ id: 'carried', label: 'Open items', build: carriedCard, status: () => (R.carried.every((x) => x.status) ? 'done' : '') });
  for (const s of SECTIONS) list.push({ id: s.id, label: s.title.replace(' BMPs', '').replace('Housekeeping & Non-Stormwater', 'Housekeeping').replace('Discharge Observations', 'Observations'), build: () => sectionCard(s), status: () => sectionStatus(s) });
  list.push({ id: 'site', label: 'Site info', build: siteCard, status: () => (missingSite().length ? '' : 'done') });
  if (R.answers.g_samples === 'yes') list.push({ id: 'sampling', label: 'Sampling', build: samplingCard, status: () => (R.sampling && R.sampling.readings.length ? 'done' : '') });
  list.push({ id: 'items', label: 'Action items', build: itemsCard, status: () => (R.items.every((x) => x.title && x.description) ? (R.items.length ? 'done' : '') : 'warn') });
  list.push({ id: 'photos', label: 'Photos', build: photosCard, status: () => (R.photos.some((p) => p.ref === 'site') ? 'done' : '') });
  list.push({ id: 'finish', label: 'Sign', build: finishCard, status: () => '' });
  return list;
}

function repaint(ids) {
  if (!cur) return;
  const all = cards();
  for (const c of all) {
    if (ids && !ids.includes(c.id)) continue;
    const old = document.getElementById('card-' + c.id);
    const fresh = c.build();
    if (old) old.replaceWith(fresh);
    else {
      // a card that wasn't there before (sampling): put it in order
      const idx = all.indexOf(c);
      const after = all.slice(0, idx).reverse().map((x) => document.getElementById('card-' + x.id)).find(Boolean);
      if (after) after.after(fresh);
    }
  }
  for (const el of [...$app.querySelectorAll('.card[id^="card-"]')]) {
    if (!all.some((c) => 'card-' + c.id === el.id)) el.remove();
  }
  paintJump();
}

function paintJump() {
  if (!cur) return;
  $jump.hidden = false;
  $jump.replaceChildren(...cards().map((c) => {
    const st = c.status();
    const a = h('a', { href: '#card-' + c.id, class: st }, (st === 'done' ? '✓ ' : '') + c.label);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('card-' + c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return a;
  }));
}

function save() {
  if (!cur) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
  paintJump();
}

function saveNow() {
  clearTimeout(saveTimer);
  if (!cur) return Promise.resolve();
  cur.rec.updated_ms = Date.now();
  return reports.put(cur.rec);
}

function card(id, title, ...kids) {
  return h('section', { class: 'card', id: 'card-' + id }, h('h2', {}, title), ...kids);
}

// --- weather -----------------------------------------------------------------------------------

function paintWeather(msg) {
  const el = document.getElementById('wx-note');
  if (el) el.textContent = msg;
}

function weatherCard() {
  const { R } = cur;
  const w = R.weather;
  const f = w.forecast;
  const tz = R.tz;
  const kids = [];
  if (f) {
    const qpe = f.qpes[0];
    kids.push(h('div', { class: 'wx-grid' },
      cell('Now', f.current ? `${f.current.temp}°${f.current.unit}, ${f.current.short}` : '--'),
      cell('Next 48 h', `${f.pop48}% · ${f.qpf48.toFixed(2)}"`),
      cell('Last rain nearby', w.last_rain ? `${mdy(w.last_rain.date)} · ${w.last_rain.in.toFixed(2)}"` : 'none in 7 days'),
      cell('Latest gauge day', w.last24 ? `${w.last24.in.toFixed(2)}" (${mdy(w.last24.date)})` : '--')));
    kids.push(h('div', { class: 'banner ' + (qpe ? 'red' : f.status === 'rain' ? 'amber' : 'green'), style: 'margin:10px 0 0' },
      qpe ? `QPE forecast: ${fmtLocal(qpe.start_ms, tz)} to ${fmtLocal(qpe.end_ms, tz)}, ${qpe.total.toFixed(2)}" at ${qpe.pop}%.`
        : f.status === 'rain' ? 'Rain in the 7-day forecast, but no QPE.' : 'No QPE in the 7-day forecast.'));
    kids.push(h('div', { class: 'wx-days' }, f.days.slice(0, 7).map((d) =>
      h('div', { class: d.pop >= 50 && d.qpf >= 0.25 ? 'wet' : '' }, mdy(d.date).slice(0, -3), h('br'), `${d.pop}%`, h('br'), `${d.qpf.toFixed(2)}"`))));
  }
  kids.push(h('p', { class: 'hint', id: 'wx-note' }, w.note || `NWS forecast pulled ${fmtLocal(f.fetched_ms, tz)}.`));
  kids.push(h('button', { class: 'btn sm', onclick: () => loadWeather(true) }, f ? 'Refresh' : 'Try again'));
  return card('wx', 'Weather', ...kids);
}

function cell(k, v) {
  return h('div', { class: 'cell' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
}

// --- inspection type -----------------------------------------------------------------------------

// The type is worked out from the forecast and the storms seen (weather.js classify); the inspector only
// confirms, or opens the toggles to change it.
function reclassify() {
  const { R } = cur;
  const c = classify(R.started_ms, R.weather.forecast, cur.seen || [], R.storm_gauge_in);
  R.classified = {
    types: c.types,
    next: c.next && { start_ms: c.next.start_ms, end_ms: c.next.end_ms, total: c.next.total },
    during: c.during && { start_ms: c.during.start_ms, end_ms: c.during.end_ms, total: c.during.total },
    recent: c.recent && { start_ms: c.recent.start_ms, end_ms: c.recent.end_ms, total: c.recent.total },
  };
  if (!R.types_touched) R.types = c.types;
  return c;
}

function typeCard() {
  const { R } = cur;
  const label = (id) => TYPES.find((t) => t.id === id).label;
  const kids = [
    h('div', { class: 'row' },
      h('div', { class: 'grow', style: 'font-weight:700;font-size:17px' }, R.types.map(label).join(' + ') || 'Pick a type'),
      R.types_touched ? h('span', { class: 'chip amber' }, 'changed by hand') : h('span', { class: 'chip green' }, 'from the forecast')),
    ...typeReasons(R.classified, R.storm_gauge_in, R.tz, !!R.weather.forecast).map((t) => h('p', { class: 'hint' }, t)),
  ];
  const c = R.classified || {};
  if (c.recent) {
    kids.push(field(`Site gauge total over that storm (inches, from the rain gauge log)`,
      h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: R.storm_gauge_in, onchange: (e) => { R.storm_gauge_in = e.target.value; reclassify(); save(); repaint(['type']); } })));
  }
  if (R.types.includes('pre') && R.inspector.role !== 'qsp') {
    kids.push(h('div', { class: 'banner red', style: 'margin:10px 0 0' },
      'The permit has a QSP do the pre-storm (QPE) inspection (Att. D III.C.3). As a delegate, check with Brandon before doing one.'));
  }
  const open = !!cur.typesOpen;
  kids.push(h('button', { class: 'btn sm ghost', style: 'padding-left:0', onclick: () => { cur.typesOpen = !open; repaint(['type']); } }, open ? 'Done' : 'Change'));
  if (open) {
    kids.push(h('div', { class: 'types' }, TYPES.map((t) => {
      const on = R.types.includes(t.id);
      return h('button', {
        class: on ? 'on' : '',
        onclick: () => {
          R.types_touched = true;
          R.types = on ? R.types.filter((x) => x !== t.id) : [...R.types, t.id];
          save();
          repaint(['type']);
        },
      }, h('span', { class: 'box' }), t.label);
    })));
    if (R.types_touched) {
      kids.push(h('button', { class: 'btn sm ghost', style: 'padding-left:0', onclick: () => { R.types_touched = false; reclassify(); save(); repaint(['type']); } }, 'Back to the worked-out type'));
    }
  }
  return card('type', 'Type of inspection', ...kids);
}

// --- carried action items ------------------------------------------------------------------------

function carriedCard() {
  const { R } = cur;
  const today = localDate(Date.now(), R.tz);
  return card('carried', 'Open items from before',
    h('p', { class: 'hint', style: 'margin-top:0' }, 'Check each one. Mark it fixed only if you saw the fix on site.'),
    R.carried.map((x) => {
      const late = x.due && x.due < today;
      const box = h('div', { class: 'item' + (x.status === 'closed' ? ' closed' : late ? ' late' : '') },
        h('div', { class: 'row' }, h('span', { class: 't grow' }, x.title), late && x.status !== 'closed' ? h('span', { class: 'chip red' }, 'LATE') : null),
        h('div', { class: 'sub' }, `Opened ${mdy(x.date)}${x.inspector ? ' by ' + x.inspector : ''}${x.due ? ' · due ' + mdy(x.due) : ''}`),
        x.description ? h('p', { style: 'margin:6px 0' }, x.description) : null,
        x.location ? h('div', { class: 'sub' }, x.location) : null,
        h('div', { class: 'seg', style: 'margin-top:10px' },
          segBtn('Still open', x.status === 'open', '', () => { x.status = 'open'; x.closed_on = ''; save(); repaint(['carried']); }),
          segBtn('Fixed', x.status === 'closed', 'good', () => { x.status = 'closed'; x.closed_on = x.closed_on || today; save(); repaint(['carried']); })));
      if (x.status === 'closed') {
        box.append(
          field('Date fixed', h('input', { type: 'date', value: x.closed_on, max: today, oninput: (e) => { x.closed_on = e.target.value; save(); } })),
          field('How it was fixed', h('input', { type: 'text', value: x.close_note, placeholder: 'e.g. silt fence repaired and re-trenched', oninput: (e) => { x.close_note = e.target.value; save(); } }), true),
          photoWidget('carried:' + x.id, x.title + ' (fixed)'),
        );
      }
      return box;
    }));
}

function segBtn(label, on, tone, onclick) {
  return h('button', { class: (on ? 'on ' : '') + (tone || ''), onclick }, label);
}

// --- checklist sections --------------------------------------------------------------------------

function sectionStatus(s) {
  const { R } = cur;
  let all = true;
  for (const q of s.questions) {
    const a = R.answers[q.id];
    if (!a) all = false;
    else if (q.bad === a && !(R.notes[q.id] || '').trim()) return 'warn';
  }
  return all ? 'done' : '';
}

function sectionCard(s) {
  const { R } = cur;
  const rest = h('button', { class: 'btn sm ghost' }, 'Rest N/A');
  rest.addEventListener('click', () => {
    for (const q of s.questions) if (!R.answers[q.id] && q.options.includes('na')) R.answers[q.id] = 'na';
    save();
    repaint([s.id]);
  });
  const hasNa = s.questions.some((q) => q.options.includes('na'));
  return h('section', { class: 'card', id: 'card-' + s.id },
    h('h2', {}, h('span', { class: 'grow' }, s.title), hasNa && s.questions.length > 2 ? rest : null),
    s.questions.map((q) => questionEl(q, s)),
    s.id === 'general' && R.site.risk_level >= 2 && R.answers.g_discharge === 'yes' && R.types.some((t) => t === 'during' || t === 'pre' || t === 'post')
      ? h('div', { class: 'banner amber', style: 'margin:10px 0 0' }, 'Discharging during a QPE: Risk Level 2 and 3 sites sample each discharge location once per 24 hours of the event (Att. D III.D.1.b). Answer Yes to samples to open the Sampling Log.')
      : null);
}

function questionEl(q, s) {
  const { R } = cur;
  const a = R.answers[q.id];
  const labels = { yes: 'Yes', no: 'No', na: 'N/A' };
  const carriedNa = a === 'na' && (R.na_from_last || []).includes(q.id);
  const el = h('div', { class: 'q', id: 'q-' + q.id },
    q.label ? h('div', { class: 'label' }, q.label, carriedNa ? h('span', { class: 'chip', style: 'margin-left:6px' }, 'N/A last time') : null) : null,
    h('div', { class: 'text' }, q.text),
    h('div', { class: 'seg' }, q.options.map((o) => segBtn(labels[o], a === o, a === o && q.bad === o ? 'bad' : '', () => {
      R.answers[q.id] = o;
      R.na_from_last = (R.na_from_last || []).filter((x) => x !== q.id);
      save();
      if (q.id === 'g_samples' || q.id === 'g_discharge') {
        if (q.id === 'g_samples' && o === 'yes' && !R.sampling) R.sampling = newSampling();
        repaint();
      } else {
        el.replaceWith(questionEl(q, s));
        paintJump();
      }
    }))));
  if (a && q.bad === a) {
    const linked = R.items.find((x) => x.from_q === q.id);
    el.append(h('div', { class: 'problem' },
      h('label', {}, "What's wrong? (required)"),
      h('textarea', { placeholder: 'Describe the problem and where it is', value: R.notes[q.id] || '', oninput: (e) => { R.notes[q.id] = e.target.value; save(); } }),
      photoWidget('q:' + q.id, q.label || 'Problem'),
      h('div', { class: 'row', style: 'margin-top:8px' },
        linked
          ? h('span', { class: 'chip blue' }, 'Action item added')
          : h('button', { class: 'btn sm', onclick: () => { addItem({ title: q.label || s.title, description: R.notes[q.id] || '', from_q: q.id }); el.replaceWith(questionEl(q, s)); } }, 'Make it an action item'))));
  }
  return el;
}

// --- site information ----------------------------------------------------------------------------

function missingSite() {
  const si = cur.R.site_info;
  const m = [];
  if (!si.phase.trim()) m.push('phase of construction');
  if (si.area === '' || si.area === null) m.push('area exposed');
  if (si.gauge_in === '' || si.gauge_in === null) m.push('rain gauge reading');
  return m;
}

function siteCard() {
  const { R } = cur;
  const si = R.site_info;
  const bind = (k) => (e) => { si[k] = e.target.value; save(); };
  const phase = h('input', { type: 'text', value: si.phase, oninput: bind('phase'), placeholder: 'e.g. Mass Grading' });
  return card('site', 'Site information',
    field('Phase of construction', phase,
      false, h('div', { class: 'picks' }, PHASES.map((p) => h('button', { onclick: () => { si.phase = p; phase.value = p; save(); } }, p)))),
    field('Current construction activities', h('textarea', { value: si.activities, oninput: bind('activities') }), true),
    field('Approximate area of site exposed (acres)', h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: si.area, oninput: bind('area') })),
    field('Activities completed since the last inspection', h('textarea', { value: si.completed, oninput: bind('completed') }), true),
    field('General weather conditions today', h('input', { type: 'text', value: si.weather_today, oninput: bind('weather_today') })),
    field('On-site rain gauge reading (inches)', h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: si.gauge_in, oninput: bind('gauge_in') }),
      false, h('p', { class: 'hint' }, 'Read the gauge on site and log it. 0.5" or more over a QPE means a post-storm inspection is owed within 96 hours after it ends.')),
    field('Start and end of the current rain event', h('input', { type: 'text', value: si.event, oninput: bind('event') }), true),
    field('Additional comments and observations', h('textarea', { value: si.comments, oninput: bind('comments') }), true));
}

function field(label, input, optional, ...after) {
  return h('div', { class: 'field' }, h('label', {}, label, optional ? h('span', { class: 'opt' }, ' (optional)') : null), input, ...after);
}

// --- sampling ------------------------------------------------------------------------------------

function newSampling() {
  return { event_type: 'Stormwater discharge', ph_meter: '', ph_cal: '', ntu_meter: '', ntu_cal: '', readings: [], grabs: [], notes: '' };
}

function samplingCard() {
  const { R } = cur;
  if (!R.sampling) R.sampling = newSampling();
  const sm = R.sampling;
  if (!sm.meters_checked) {
    sm.meters_checked = true;
    kv.get('meters').then((m) => {
      if (m && (m.ph_meter || m.ntu_meter) && !sm.ph_meter && !sm.ntu_meter) {
        Object.assign(sm, m);
        save();
        repaint(['sampling']);
      }
    });
  }
  const bind = (k) => (e) => { sm[k] = e.target.value; save(); rememberMeters(); };
  const nal = (x) => {
    const ph = x.ph === '' ? null : Number(x.ph);
    const ntu = x.ntu === '' ? null : Number(x.ntu);
    return (ph !== null && (ph < NAL.ph_low || ph > NAL.ph_high)) || (ntu !== null && ntu > NAL.ntu);
  };
  return card('sampling', 'Sampling Log',
    h('div', { class: 'seg' }, ['Stormwater discharge', 'Dewatering', 'Non-visible pollutant'].map((t) =>
      segBtn(t, sm.event_type === t, '', () => { sm.event_type = t; save(); repaint(['sampling']); }))),
    h('h3', {}, 'Field meters'),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, field('pH meter', h('input', { type: 'text', value: sm.ph_meter, oninput: bind('ph_meter') }))),
      h('div', { class: 'grow' }, field('Calibrated', h('input', { type: 'date', value: sm.ph_cal, oninput: bind('ph_cal') })))),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, field('Turbidity meter', h('input', { type: 'text', value: sm.ntu_meter, oninput: bind('ntu_meter') }))),
      h('div', { class: 'grow' }, field('Calibrated', h('input', { type: 'date', value: sm.ntu_cal, oninput: bind('ntu_cal') })))),
    h('h3', {}, 'pH and turbidity readings'),
    sm.readings.map((x, i) => h('div', { class: 'item' + (nal(x) ? ' late' : '') },
      field('Discharge location', h('input', { type: 'text', value: x.location, oninput: (e) => { x.location = e.target.value; save(); } }),
        false, (cur.site.discharge_points || []).length ? h('div', { class: 'picks' }, cur.site.discharge_points.map((p) => h('button', { onclick: () => { x.location = p; save(); repaint(['sampling']); } }, p))) : null),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, field('pH', h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: x.ph, onchange: (e) => { x.ph = e.target.value; save(); repaint(['sampling']); } }))),
        h('div', { class: 'grow' }, field('Turbidity (NTU)', h('input', { type: 'number', inputmode: 'decimal', step: '1', value: x.ntu, onchange: (e) => { x.ntu = e.target.value; save(); repaint(['sampling']); } }))),
        h('div', { class: 'grow' }, field('Time', h('input', { type: 'time', value: timeOf(x.time_ms), onchange: (e) => { x.time_ms = atTime(e.target.value); save(); } })))),
      nal(x) ? h('div', { class: 'banner red', style: 'margin:6px 0' }, 'Over the numeric action level (pH 6.5 to 8.5, turbidity 250 NTU). Tell Brandon today: the result goes in SMARTS within 10 days.') : null,
      h('button', { class: 'btn sm ghost danger', onclick: () => { sm.readings.splice(i, 1); save(); repaint(['sampling']); } }, 'Remove reading'))),
    h('button', { class: 'btn sm', onclick: () => { sm.readings.push({ location: '', ph: '', ntu: '', time_ms: Date.now() }); save(); repaint(['sampling']); } }, '+ Add a reading'),
    h('h3', {}, 'Grab samples for the lab'),
    sm.grabs.map((x, i) => h('div', { class: 'item' },
      field('Discharge location', h('input', { type: 'text', value: x.location, oninput: (e) => { x.location = e.target.value; save(); } })),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, field('Sample type', h('input', { type: 'text', value: x.type, oninput: (e) => { x.type = e.target.value; save(); } }))),
        h('div', { class: 'grow' }, field('Time', h('input', { type: 'time', value: timeOf(x.time_ms), onchange: (e) => { x.time_ms = atTime(e.target.value); save(); } })))),
      h('button', { class: 'btn sm ghost danger', onclick: () => { sm.grabs.splice(i, 1); save(); repaint(['sampling']); } }, 'Remove'))),
    h('button', { class: 'btn sm', onclick: () => { sm.grabs.push({ location: '', type: '', time_ms: Date.now() }); save(); repaint(['sampling']); } }, '+ Add a grab sample'),
    field('Sampling notes', h('textarea', { value: sm.notes, oninput: bind('notes') }), true));
}

function rememberMeters() {
  const sm = cur && cur.R.sampling;
  if (sm) kv.set('meters', { ph_meter: sm.ph_meter, ph_cal: sm.ph_cal, ntu_meter: sm.ntu_meter, ntu_cal: sm.ntu_cal });
}

function timeOf(ms) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: cur.R.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

function atTime(hhmm) {
  // the inspection's date at a local clock time
  if (!hhmm) return null;
  const [hh, mm] = hhmm.split(':').map(Number);
  const base = cur.R.started_ms;
  const curT = timeOf(base).split(':').map(Number);
  return base + ((hh - curT[0]) * 60 + (mm - curT[1])) * 60e3;
}

// --- new action items ----------------------------------------------------------------------------

function addItem(seed = {}) {
  const { R } = cur;
  const it = { id: uid().slice(0, 8), title: '', location: '', description: '', priority_days: 7, due: addDays(R.date, 7), gps: null, ...seed };
  R.items.push(it);
  where(10000).then((g) => { if (g) { it.gps = g; save(); } });
  save();
  repaint(['items']);
  toast('Action item added');
  return it;
}

function itemsCard() {
  const { R } = cur;
  return card('items', 'New action items',
    R.items.length ? null : h('p', { class: 'hint', style: 'margin-top:0' }, 'Anything the contractor needs to fix. Each one carries forward until someone marks it fixed.'),
    R.items.map((x, i) => h('div', { class: 'item' },
      field('Item', h('input', { type: 'text', value: x.title, placeholder: 'e.g. Silt fence', oninput: (e) => { x.title = e.target.value; save(); } })),
      field("What's wrong and what to do", h('textarea', { value: x.description, oninput: (e) => { x.description = e.target.value; save(); } })),
      field('Where on site', h('input', { type: 'text', value: x.location, placeholder: 'e.g. northwest gravel parking area', oninput: (e) => { x.location = e.target.value; save(); } }), true),
      h('div', { class: 'field' }, h('label', {}, 'Fix within'),
        h('div', { class: 'seg' }, PRIORITY_DAYS.map((d) => segBtn(`${d} days`, x.priority_days === d, '', () => {
          x.priority_days = d;
          x.due = addDays(R.date, d);
          save();
          repaint(['items']);
        })))),
      photoWidget('item:' + x.id, x.title || 'Action item'),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('span', { class: 'sub grow' }, x.gps ? `GPS ${x.gps.lat.toFixed(5)}, ${x.gps.lon.toFixed(5)}` : 'No GPS fix yet'),
        h('button', { class: 'btn sm ghost danger', onclick: () => { R.items.splice(i, 1); save(); repaint(['items']); } }, 'Remove')))),
    h('button', { class: 'btn block', onclick: () => addItem() }, '+ Add an action item'));
}

// --- photos --------------------------------------------------------------------------------------

function photoWidget(ref, caption) {
  const { R, rec } = cur;
  const wrap = h('div', {});
  const draw = async () => {
    const mine = R.photos.filter((p) => p.ref === ref);
    const thumbs = [];
    for (const p of mine) {
      const b = await blobs.get(`photo:${rec.id}:${p.id}`);
      const src = b ? URL.createObjectURL(b) : '';
      thumbs.push(h('div', { class: 'thumb' }, src ? h('img', { src, alt: p.caption }) : null,
        h('div', { class: 'cap' }, shortTime(p.taken_ms, R.tz)),
        h('button', { 'aria-label': 'Remove photo', onclick: async () => {
          R.photos = R.photos.filter((x) => x !== p);
          await blobs.del(`photo:${rec.id}:${p.id}`);
          save();
          draw();
        } }, '×')));
    }
    const add = h('button', { class: 'btn sm' }, mine.length ? '+ Photo' : '+ Add photo');
    add.addEventListener('click', () => pickPhotos(ref, caption, draw));
    wrap.replaceChildren(thumbs.length ? h('div', { class: 'thumbs' }, thumbs) : '', h('div', { style: 'margin-top:8px' }, add));
  };
  draw();
  return wrap;
}

function pickPhotos(ref, caption, done) {
  const { R, rec } = cur;
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.remove();
    if (!files.length) return;
    toast(files.length > 1 ? `Saving ${files.length} photos…` : 'Saving photo…', 1500);
    const gps = await where(6000);
    for (const f of files) {
      try {
        const { blob } = await shrinkPhoto(f);
        const id = uid().slice(0, 8);
        await blobs.put(`photo:${rec.id}:${id}`, blob);
        R.photos.push({ id, ref, caption, taken_ms: f.lastModified && Math.abs(Date.now() - f.lastModified) < 12 * HOUR ? f.lastModified : Date.now(), gps });
      } catch (e) {
        toast("Couldn't read that photo.");
      }
    }
    await saveNow();
    paintJump();
    done();
  });
  input.click();
}

function photosCard() {
  return card('photos', 'Site photos',
    h('p', { class: 'hint', style: 'margin-top:0' }, 'General photos of the site and the BMPs. Problem photos go with their question or action item above.'),
    photoWidget('site', 'Site'));
}

// --- finish and sign ----------------------------------------------------------------------------

function missingAll() {
  const { R } = cur;
  const m = [];
  if (!R.types.length) m.push(['type', 'Pick the inspection type']);
  if (R.carried.some((x) => !x.status)) m.push(['carried', 'Mark each open item still open or fixed']);
  for (const s of SECTIONS) {
    const unanswered = s.questions.filter((q) => !R.answers[q.id]).length;
    if (unanswered) m.push([s.id, `${s.title}: ${unanswered} unanswered`]);
    const noNote = s.questions.filter((q) => R.answers[q.id] && q.bad === R.answers[q.id] && !(R.notes[q.id] || '').trim()).length;
    if (noNote) m.push([s.id, `${s.title}: describe ${noNote === 1 ? 'the problem' : `the ${noNote} problems`}`]);
  }
  const ms = missingSite();
  if (ms.length) m.push(['site', `Site information: ${ms.join(', ')}`]);
  if (R.answers.g_samples === 'yes' && !(R.sampling && R.sampling.readings.length)) m.push(['sampling', 'Sampling Log: add the readings']);
  if (R.items.some((x) => !x.title.trim() || !x.description.trim())) m.push(['items', 'Action items: each needs a name and a description']);
  return m;
}

function finishCard() {
  const { R } = cur;
  const missing = missingAll();
  const canvas = h('canvas', { class: 'sig' });
  const btn = h('button', { class: 'btn primary block big', disabled: true }, 'Sign & finish');
  const clear = h('button', { class: 'btn sm ghost' }, 'Clear');
  const ins = R.inspector;
  const el = card('finish', 'Sign & finish',
    missing.length
      ? h('div', { class: 'banner red' }, h('strong', {}, 'Still needed:'),
        h('ul', { class: 'missing' }, missing.map(([id, t]) => h('li', {}, h('a', { href: '#card-' + id, onclick: (e) => { e.preventDefault(); document.getElementById('card-' + id)?.scrollIntoView({ behavior: 'smooth' }); } }, t)))),
        h('button', { class: 'btn sm', style: 'margin-top:6px', onclick: () => repaint(['finish']) }, 'Check again'))
      : h('div', { class: 'banner green' }, 'Everything is filled in.'),
    h('p', { style: 'margin:12px 0 4px' }, h('strong', {}, ins.name), `, ${ins.title}`, ins.cert ? h('span', { class: 'sub' }, ` · ${ins.cert}`) : null),
    h('div', { class: 'row' }, h('span', { class: 'sub grow' }, 'Sign with your finger'), clear),
    canvas,
    h('div', { style: 'height:12px' }),
    btn,
    h('p', { class: 'hint' }, 'Signing locks the report, makes the PDF on this phone and queues it to upload. It works with no signal.'));
  requestAnimationFrame(() => {
    const pad = new SigPad(canvas);
    cur.pad = pad;
    pad.onchange = () => { btn.disabled = pad.isEmpty() || missingAll().length > 0; };
    clear.addEventListener('click', () => pad.clear());
  });
  btn.addEventListener('click', () => finish(btn));
  return el;
}

async function finish(btn) {
  const { R, rec, pad } = cur;
  if (missingAll().length || !pad || pad.isEmpty()) return repaint(['finish']);
  btn.disabled = true;
  btn.textContent = 'Making the PDF…';
  try {
    if (!R.weather.forecast && navigator.onLine) {
      const wx = await pullWeather(cur.site, 10000).catch(() => null);
      if (wx && wx.forecast) applyWeather(wx);
    }
    R.finished_ms = Date.now();
    R.signature = { signed_ms: R.finished_ms, name: R.inspector.name, title: R.inspector.title, cert: R.inspector.cert || '' };
    // photo order in the PDF: open items, new items, problems, then the site
    const rank = (p) => ({ carried: 0, item: 1, q: 2, site: 3 }[p.ref.split(':')[0]] ?? 4);
    R.photos.sort((a, b) => rank(a) - rank(b) || a.taken_ms - b.taken_ms);
    R.carried.forEach((x) => { if (x.status === 'open') x.close_note = ''; });

    const sigBlob = await pad.toBlob();
    await blobs.put(`sig:${rec.id}`, sigBlob);
    const logo = await fetch('img/logo.png').then((r) => r.blob()).then(blobToDataUrl).catch(() => null);
    const pdf = await buildPdf(R, {
      logo,
      sig: await blobToDataUrl(sigBlob),
      loadPhoto: async (p) => {
        const b = await blobs.get(`photo:${rec.id}:${p.id}`);
        return b ? photoDataUrl(b) : null;
      },
    });
    await blobs.put(`pdf:${rec.id}`, pdf);

    const same = (await reports.all()).filter((x) => x.id !== rec.id && x.site_id === rec.site_id && x.status !== 'draft' && x.data.date === R.date).length;
    const base = (rec.meta.pdf_name || `${R.site.name}-CA SWPPP-{date}.pdf`).replace('{date}', R.date);
    const pdfName = same ? base.replace(/\.pdf$/i, ` (${same + 1}).pdf`) : base;
    const safe = (s) => (s || 'Photo').replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
    rec.files = [
      ...R.photos.map((p, i) => ({ key: `photo:${rec.id}:${p.id}`, name: `Photo ${String(i + 1).padStart(2, '0')} - ${safe(p.caption)}.jpg`, kind: 'photo', mime: 'image/jpeg' })),
      { key: `sig:${rec.id}`, name: 'Signature.png', kind: 'signature', mime: 'image/png' },
      { key: `pdf:${rec.id}`, name: pdfName, kind: 'pdf', mime: 'application/pdf' },
    ];
    rec.meta = { ...rec.meta, pdf_name_final: pdfName, date: R.date };
    rec.status = 'signed';
    await reports.put(rec);
    cur = null;
    go({ name: 'done', id: rec.id }, true);
    flush();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Sign & finish';
    toast('Something went wrong making the PDF: ' + e.message, 6000);
    console.error(e);
  }
}

// ---------------------------------------------------------------------------------------------
// a finished report

async function renderDone(id) {
  cur = null;
  const rec = await reports.get(id);
  if (!rec) return go({ name: 'home' }, true);
  $title.textContent = rec.data.site.name;
  $back.hidden = false;
  const pdf = await blobs.get(`pdf:${id}`);
  const url = pdf ? URL.createObjectURL(pdf) : null;
  const name = rec.meta.pdf_name_final;
  const status = rec.status === 'filed'
    ? h('div', { class: 'banner green' }, h('strong', {}, 'Filed. '), rec.filed && rec.filed.drafted ? 'The report email is waiting in Brandon\'s drafts.' : 'Brandon has it.')
    : h('div', { class: 'banner amber', id: 'up-' + id }, h('strong', {}, 'Saved on this phone. '), uploadNote[id] || 'It uploads on its own once there is signal; open the app when you have bars.');
  const kids = [
    status,
    h('div', { class: 'card' },
      h('h2', {}, 'Report signed'),
      h('p', { class: 'sub', style: 'margin-top:0' }, `${mdy(rec.data.date)} · ${fmtLocal(rec.data.started_ms, rec.data.tz, { weekday: undefined, month: undefined, day: undefined })} to ${fmtLocal(rec.data.finished_ms, rec.data.tz, { weekday: undefined, month: undefined, day: undefined })} · ${rec.data.inspector.name}`),
      h('p', { class: 'small' }, name),
      url ? h('a', { class: 'btn primary block', href: url, target: '_blank', rel: 'noopener', download: name }, 'Open the PDF') : h('p', {}, 'The PDF is missing on this phone.'),
      url && navigator.canShare && navigator.canShare({ files: [new File([pdf], name, { type: 'application/pdf' })] })
        ? h('button', { class: 'btn block', style: 'margin-top:8px', onclick: () => navigator.share({ files: [new File([pdf], name, { type: 'application/pdf' })], title: name }).catch(() => {}) }, 'Share the PDF')
        : null),
    h('button', { class: 'btn block', onclick: () => go({ name: 'home' }) }, 'Back to sites'),
  ];
  if (rec.status !== 'filed') kids.splice(2, 0, h('button', { class: 'btn block', style: 'margin-bottom:12px', onclick: () => flush(true) }, 'Upload now'));
  $app.replaceChildren(...kids);
}

// ---------------------------------------------------------------------------------------------
// the upload queue

// A phone says it has signal a moment before data really flows, so a failed try is retried after
// 10 s, 30 s, then every minute; the 90 s timer and reopening the app also try.
let retryTimer = null;
let retryStep = 0;

async function flush(loud) {
  const waiting = (await reports.all()).filter((r) => r.status === 'signed');
  if (!waiting.length) return;
  if (!navigator.onLine) {
    if (loud) toast('No signal yet. It will upload once there is some.');
    return;
  }
  const { filed, failed } = await flushQueue((r, text) => {
    uploadNote[r.id] = text;
    const el = document.getElementById('up-' + r.id);
    if (el) el.lastChild.textContent = text;
  });
  netBadge();
  clearTimeout(retryTimer);
  if (failed) {
    retryTimer = setTimeout(() => flush(), [10e3, 30e3, 60e3][Math.min(retryStep, 2)]);
    retryStep += 1;
    if (loud) toast('Not through yet. It will keep trying.');
  } else {
    retryStep = 0;
  }
  if (filed) {
    toast(filed === 1 ? 'Report filed.' : `${filed} reports filed.`);
    syncConfig().then(() => { if (view.name === 'home') renderHome(); });
  }
  if (view.name === 'home' || view.name === 'done') render();
}

// ---------------------------------------------------------------------------------------------
// start up

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const watch = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          swWaiting = w;
          if (view.name === 'home') renderHome();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) swWaiting = reg.waiting;
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || view.name === 'inspect') return;
    reloading = true;
    location.reload();
  });
}

async function boot() {
  registerSW();
  persist();
  netBadge();
  window.addEventListener('online', () => { netBadge(); setTimeout(() => { flush(); prefetchWeather(); }, 3000); });
  window.addEventListener('offline', netBadge);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { flush(); prefetchWeather(); }
    else saveNow();
  });
  setInterval(() => flush(), 90e3);

  const params = new URLSearchParams(location.search);
  if (LOCAL && params.get('backend')) await kv.set('backend_override', params.get('backend'));

  const cfg = await kv.get('config');
  if (!cfg) {
    view = { name: 'signin' };
    history.replaceState(view, '');
    return render();
  }
  view = { name: 'home' };
  history.replaceState(view, '');
  await render();
  prefetchWeather().then(syncConfig).then((c) => { if (c && view.name === 'home') renderHome(); });
  flush();
}

boot();
