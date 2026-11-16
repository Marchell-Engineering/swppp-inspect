// A site's History calendar and its Reports / Action items lists (Brandon 11/16: "a clickable calendar with
// inspections and action items", and the action items tab "so they can see when things are getting addressed").
// One copy, used twice: the app's History screen (main.js, inspectors, with Get the PDF and Correct on a report)
// and the report email's no-login page (fix.js, the client's read-only copy, Brandon 11/16: "can you add the
// interactive history/calendar to the email?"). The caller hands in how a report row is drawn and where the
// chosen tab is kept; nothing here talks to the script or the phone's store.

import { h, segBtn } from './dom.js';
import { TYPES, MISSED_REASONS } from './checklist.js';
import { fmtLocal } from './weather.js';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const mdy = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
const shortDate = (ms, tz) => fmtLocal(ms, tz, { weekday: 'short', hour: undefined, minute: undefined });

export function historyTitle(r) {
  if (r.kind === 'missed') return 'Not conducted';
  if (r.kind === 'bank') return r.pr ? `PR#${r.pr} walk` : 'Bank walk';
  const words = (r.types || []).map((id) => (TYPES.find((t) => t.id === id) || { label: id }).label);
  return words.join(', ') || 'Inspection';
}

export function missedWords(id) {
  const m = (MISSED_REASONS || []).find((x) => x.id === id);
  return m ? m.label : id;
}

// one report's row: the date and type, who, the gauge, a couldn't-inspect reason, the revision. `slot` holds the
// app's buttons (none on the email's page) and `note` its messages.
export function reportRow(r, slot, note) {
  const bits = [r.who, r.gauge_text ? (/^\d/.test(r.gauge_text) ? `gauge ${r.gauge_text}` : r.gauge_text) : '', r.reason ? missedWords(r.reason) : '', r.revision ? `Revision ${r.revision}` : ''].filter(Boolean);
  return h('li', {},
    h('div', { class: 'grow' }, h('div', { style: 'font-weight:650' }, `${mdy(r.date)} · ${historyTitle(r)}`), h('div', { class: 'sub' }, bits.join(' · ')), note),
    slot);
}

// an item's standing: { word, tone, closed } as of today
export function itemState(x, today) {
  if (x.closed_on) {
    const late = x.due && x.closed_on > x.due ? Math.round((Date.parse(x.closed_on) - Date.parse(x.due)) / 864e5) : 0;
    return { word: `Fixed ${mdy(x.closed_on)}${late ? `, ${late} day${late > 1 ? 's' : ''} late` : x.due ? ', on time' : ''}`, tone: late ? 'amber' : 'green', closed: true };
  }
  if (x.closed_text) return { word: 'Closed, date not on record', tone: '', closed: true };
  if (x.reported) return { word: `Marked fixed by ${x.reported.by}, to confirm`, tone: 'blue', closed: false };
  if (x.due && x.due < today) return { word: `Open, ${Math.round((Date.parse(today) - Date.parse(x.due)) / 864e5)} days past due`, tone: 'red', closed: false };
  return { word: 'Open', tone: 'amber', closed: false };
}

// each day's events: { reports: [], opened: [], due: [], fixed: [], seen: [] }
export function dayEvents(rows, items) {
  const days = {};
  const at = (d) => days[d] || (days[d] = { reports: [], opened: [], due: [], fixed: [], seen: [] });
  for (const r of rows) if (r.date) at(r.date).reports.push(r);
  for (const x of items) {
    if (x.opened) at(x.opened).opened.push(x);
    if (x.due) at(x.due).due.push(x);
    if (x.closed_on) at(x.closed_on).fixed.push(x);
    for (const d of x.seen_open || []) at(d).seen.push(x);
  }
  return days;
}

export function itemRow(x, today, onDay) {
  const st = itemState(x, today);
  const bits = [`Opened ${mdy(x.opened)}${x.by ? ' by ' + x.by : ''}`, x.due ? `due ${mdy(x.due)}` : ''].filter(Boolean);
  const kids = [
    h('div', { class: 'row' }, h('span', { class: 't grow', style: 'font-weight:650' }, x.title), h('span', { class: 'chip ' + st.tone }, st.word)),
    h('div', { class: 'sub' }, bits.join(' · ')),
  ];
  if (x.description) kids.push(h('p', { style: 'margin:6px 0 0' }, x.description));
  if (x.location) kids.push(h('div', { class: 'sub' }, x.location));
  if ((x.seen_open || []).length) kids.push(h('div', { class: 'sub' }, `Still open at the ${x.seen_open.map(mdy).join(', ')} inspection${x.seen_open.length > 1 ? 's' : ''}`));
  if (x.reported) kids.push(h('div', { class: 'sub' }, `${x.reported.by} marked it fixed ${shortDate(x.reported.at, 'America/Los_Angeles')}${x.reported.note ? `: "${x.reported.note}"` : ''}`));
  if (x.closed_on && (x.close_note || x.confirmed_on)) {
    kids.push(h('div', { class: 'sub' }, [x.close_note ? `"${x.close_note}"` : '', x.confirmed_on ? `confirmed at the ${mdy(x.confirmed_on)} inspection${x.confirmed_by ? ' (' + x.confirmed_by + ')' : ''}` : ''].filter(Boolean).join(', ')));
  }
  if (x.closed_text) kids.push(h('div', { class: 'sub' }, x.closed_text));
  if (onDay && x.opened) kids.push(h('button', { class: 'btn sm ghost', style: 'margin-top:4px;padding-left:0', onclick: () => onDay(x.opened) }, 'On the calendar'));
  return h('li', { class: 'hist-item' }, h('div', { class: 'grow' }, ...kids));
}

// The calendar (with the tapped day's panel under it) and the Reports / Action items lists.
//   rows      the site's reports, newest first (undefined: not here yet)
//   items     every action item at the site (undefined: no items tab, as on a bank site)
//   today     YYYY-MM-DD at the site
//   row(r)    draws one report's <li>
//   tab       the tab to open on; onTab(t) keeps the reader's pick
//   hints     { reports: text under the Reports list, empty: text when there are no reports }
// Returns { cal, list, repaint }: two nodes to place, and repaint() for when an item changes under it.
export function historyView({ rows, items, today, row, tab = 'reports', onTab, hints = {} }) {
  const reportRows = rows || [];
  const hasItems = Array.isArray(items);
  const its = items || [];
  let days = dayEvents(reportRows, its);
  const view = { month: today.slice(0, 7), day: '', tab: tab === 'items' && hasItems ? 'items' : 'reports' };

  const calBox = h('div', {});
  const dayBox = h('div', {});
  const listBox = h('div', {});

  const showDay = (d) => {
    view.day = d;
    view.month = d.slice(0, 7);
    paintCal();
    paintDay();
    calBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  function paintCal() {
    const [y, m] = view.month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < first.getUTCDay(); i++) cells.push(h('div', { class: 'cal-day empty' }));
    for (let d = 1; d <= n; d++) {
      const iso = `${view.month}-${String(d).padStart(2, '0')}`;
      const e = days[iso];
      const marks = [];
      if (e) {
        for (const r of e.reports) marks.push(h('span', { class: 'mk ' + (r.kind === 'missed' ? 'missed' : 'insp'), title: historyTitle(r) }));
        if (e.opened.length) marks.push(h('span', { class: 'mk opened', title: 'Item opened' }));
        if (e.fixed.length) marks.push(h('span', { class: 'mk fixed', title: 'Item fixed' }));
        // a due date still open, or missed: red; one met: an outline
        if (e.due.length) marks.push(h('span', { class: 'mk due' + (e.due.some((x) => !x.closed_on && !x.closed_text ? iso < today : x.closed_on > x.due) ? ' late' : ''), title: 'Item due' }));
      }
      cells.push(h('button', {
        class: 'cal-day' + (iso === today ? ' today' : '') + (iso === view.day ? ' on' : '') + (e ? ' has' : ''),
        onclick: () => { view.day = iso; paintCal(); paintDay(); },
      }, h('span', { class: 'n' }, String(d)), h('span', { class: 'mks' }, marks)));
    }
    const step = (k) => {
      const t = new Date(Date.UTC(y, m - 1 + k, 1));
      view.month = t.toISOString().slice(0, 7);
      view.day = '';
      paintCal();
      paintDay();
    };
    calBox.replaceChildren(
      h('div', { class: 'row cal-head' },
        h('button', { class: 'btn sm ghost', 'aria-label': 'Month before', onclick: () => step(-1) }, '‹'),
        h('strong', { class: 'grow', style: 'text-align:center' }, `${MONTHS[m - 1]} ${y}`),
        h('button', { class: 'btn sm ghost', 'aria-label': 'Month after', onclick: () => step(1) }, '›')),
      h('div', { class: 'cal' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => h('div', { class: 'cal-w' }, w)), cells),
      h('div', { class: 'cal-key' },
        h('span', {}, h('span', { class: 'mk insp' }), 'Report'),
        h('span', {}, h('span', { class: 'mk missed' }), "Couldn't inspect"),
        hasItems ? h('span', {}, h('span', { class: 'mk opened' }), 'Item opened') : null,
        hasItems ? h('span', {}, h('span', { class: 'mk due' }), 'Item due') : null,
        hasItems ? h('span', {}, h('span', { class: 'mk fixed' }), 'Item fixed') : null));
  }

  function paintDay() {
    const e = view.day && days[view.day];
    if (!view.day) return dayBox.replaceChildren();
    const parts = [h('h3', { style: 'margin-top:0' }, new Date(view.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }))];
    if (!e) parts.push(h('p', { class: 'hint', style: 'margin:0' }, 'Nothing on file this day.'));
    else {
      if (e.reports.length) parts.push(h('ul', { class: 'list' }, e.reports.map(row)));
      const group = (label, list) => { if (list.length) parts.push(h('div', { class: 'sub', style: 'margin-top:10px;font-weight:650' }, label), h('ul', { class: 'list' }, list.map((x) => itemRow(x, today)))); };
      group('Items opened', e.opened);
      group('Items fixed', e.fixed);
      group('Items due', e.due);
      group('Items still open at this inspection', e.seen);
    }
    dayBox.replaceChildren(h('div', { class: 'day-panel' }, parts));
  }

  function paintList() {
    const tabs = h('div', { class: 'seg', style: 'margin-bottom:10px' },
      segBtn(`Reports (${reportRows.length})`, view.tab === 'reports', '', () => setTab('reports')),
      hasItems ? segBtn(`Action items (${its.length})`, view.tab === 'items', '', () => setTab('items')) : null);
    let body;
    if (view.tab === 'items') {
      const open = its.filter((x) => !itemState(x, today).closed);
      const closed = its.filter((x) => itemState(x, today).closed);
      body = its.length
        ? [open.length ? h('div', { class: 'sub', style: 'font-weight:650' }, `Open (${open.length})`) : h('p', { class: 'hint', style: 'margin:0' }, 'No open items.'),
          open.length ? h('ul', { class: 'list' }, open.map((x) => itemRow(x, today, showDay))) : null,
          closed.length ? h('div', { class: 'sub', style: 'font-weight:650;margin-top:12px' }, `Closed (${closed.length})`) : null,
          closed.length ? h('ul', { class: 'list' }, closed.map((x) => itemRow(x, today, showDay))) : null]
        : [h('p', { class: 'hint', style: 'margin:0' }, 'No action items on record here.')];
    } else {
      body = reportRows.length
        ? [h('ul', { class: 'list' }, reportRows.map(row)), hints.reports ? h('p', { class: 'hint' }, hints.reports) : null]
        : [h('p', { class: 'hint', style: 'margin:0' }, (rows ? hints.empty : hints.missing) || 'Nothing on file here yet.')];
    }
    listBox.replaceChildren(tabs, ...body);
  }

  function setTab(t) {
    view.tab = t;
    if (onTab) onTab(t);
    paintList();
  }

  const repaint = () => {
    days = dayEvents(reportRows, its);
    paintCal();
    paintDay();
    paintList();
  };
  repaint();
  return { cal: h('div', {}, calBox, dayBox), list: listBox, repaint };
}
