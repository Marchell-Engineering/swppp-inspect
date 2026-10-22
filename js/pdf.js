// The report PDF, made on the phone at signing (pdfmake, bundled in vendor/). Section order follows the
// ComplianceGo "CA SWPPP" report Bechtel is used to: header, weather, permit, inspection type, the
// checklist, site information, sampling, action items and the signature; then the photos and the gauge
// history behind it.

import { SECTIONS, TYPES, ANSWER_LABEL, NAL } from './checklist.js';
import { fmtLocal, typeReasons } from './weather.js';

const BLUE = '#24408e';
const INK = '#1b1f2a';
const MUTED = '#5b6372';
const RED = '#b3261e';
const RULE = '#d5d9e2';

const dt = (ms, tz) => (ms ? fmtLocal(ms, tz, { weekday: undefined, year: 'numeric' }) : '');
const day = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
};
const inches = (v) => (v === null || v === undefined || v === '' ? '--' : `${Number(v).toFixed(2)}"`);

function bar(text, level = 1) {
  return {
    headlineLevel: level,
    table: { widths: ['*'], body: [[{ text, color: '#fff', bold: true, fontSize: 10.5, margin: [6, 3, 6, 3] }]] },
    layout: { fillColor: BLUE, hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: [0, 12, 0, 6],
  };
}

function checkbox(on) {
  const c = [{ type: 'rect', x: 0, y: 1, w: 9, h: 9, lineWidth: 0.8, lineColor: INK }];
  if (on) {
    c.push({ type: 'line', x1: 1.8, y1: 5.6, x2: 4, y2: 8.2, lineWidth: 1.6, lineColor: BLUE, lineCap: 'round' });
    c.push({ type: 'line', x1: 4, y1: 8.2, x2: 8.2, y2: 2.4, lineWidth: 1.6, lineColor: BLUE, lineCap: 'round' });
  }
  return { canvas: c, width: 12 };
}

const grid = {
  hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => RULE, vLineColor: () => RULE,
  paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3,
};

const rows = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5), vLineWidth: () => 0,
  hLineColor: () => RULE, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 4, paddingBottom: () => 4,
};

function headerBlock(r, logo) {
  const s = r.site;
  const insp = r.inspector;
  const tz = r.tz;
  const gps = r.gps ? `${r.gps.lat.toFixed(5)}, ${r.gps.lon.toFixed(5)} (±${r.gps.acc} m)` : 'no GPS fix';
  return {
    columns: [
      logo ? { image: logo, width: 150 } : { text: 'Marchell Engineering', bold: true, color: BLUE, width: 150 },
      {
        width: '*',
        stack: [
          { text: s.name, bold: true, fontSize: 14, alignment: 'right', margin: [0, 0, 0, 6] },
          {
            table: {
              widths: [78, '*'],
              body: [
                ['Inspector', `${insp.name}, ${insp.title}`],
                ['Started', dt(r.started_ms, tz)],
                ['Finished', dt(r.finished_ms, tz)],
                ['Site', s.address || ''],
                ['GPS at start', gps],
              ].map(([a, b]) => [{ text: a, color: MUTED }, { text: b }]),
            },
            layout: grid,
            fontSize: 8.5,
          },
        ],
      },
    ],
    columnGap: 16,
  };
}

function weatherBlock(r) {
  const w = r.weather || {};
  const f = w.forecast;
  const g = w.gauges;
  const tz = r.tz;
  const out = [bar('Site Weather Information')];
  if (!f) {
    out.push({ text: w.note || 'The NWS forecast could not be pulled on this phone before the inspection.', italics: true, color: MUTED });
  } else {
    const last = w.last_rain ? `${day(w.last_rain.date)}: ${inches(w.last_rain.in)} (${w.last_rain.gauge})` : 'none in the past 7 days';
    const last24 = w.last24 ? `${inches(w.last24.in)} (${day(w.last24.date)}, ${w.last24.gauge})` : '--';
    out.push({
      table: {
        widths: ['*', '*', '*', '*'],
        body: [
          ['Current conditions', 'Last rain (nearby gauges)', 'Latest daily gauge reading', '48-hour forecast'].map((t) => ({ text: t, color: MUTED, fontSize: 8 })),
          [
            f.current ? `${f.current.temp}°${f.current.unit}, ${f.current.short}` : '--',
            last,
            last24,
            `${f.pop48}% chance, ${inches(f.qpf48)} forecast`,
          ].map((t) => ({ text: t, bold: true })),
        ],
      },
      layout: grid,
    });
    const qpeText = f.qpes.length
      ? f.qpes.map((q) => `QPE forecast: ${fmtLocal(q.start_ms, tz)} to ${fmtLocal(q.end_ms, tz)}, ${inches(q.total)} at ${q.pop}% chance.`).join('\n')
      : 'No Qualifying Precipitation Event (50% chance of 0.5" or more in 24 hours) in the 7-day NWS forecast.';
    out.push({ text: qpeText, bold: f.qpes.length > 0, color: f.qpes.length ? RED : INK, margin: [0, 6, 0, 4] });
    out.push({
      table: {
        widths: [62, ...f.days.map(() => '*')],
        body: [
          [{ text: 'Forecast', color: MUTED }, ...f.days.map((d) => ({ text: day(d.date), alignment: 'center', color: MUTED }))],
          [{ text: 'Chance', color: MUTED }, ...f.days.map((d) => ({ text: `${d.pop}%`, alignment: 'center' }))],
          [{ text: 'Inches', color: MUTED }, ...f.days.map((d) => ({ text: d.qpf ? d.qpf.toFixed(2) : '0', alignment: 'center' }))],
        ],
      },
      layout: grid,
      fontSize: 8,
    });
    out.push({
      text: `NWS gridpoint forecast (${f.office} ${f.grid}, near ${f.near}), issued ${f.issued ? dt(Date.parse(f.issued), tz) : '--'}, pulled ${dt(f.fetched_ms, tz)} by the inspector's phone. ${f.source_url}`,
      fontSize: 7, color: MUTED, margin: [0, 3, 0, 0],
    });
  }
  if (!g) out.push({ text: 'Nearby gauge readings could not be pulled before the inspection.', fontSize: 7, color: MUTED, margin: [0, 2, 0, 0] });
  return out;
}

function permitBlock(r) {
  const p = r.site.permit || {};
  return [
    bar('Permit'),
    {
      table: {
        widths: [70, '*', 40, 62, 62, '*'],
        body: [
          ['WDID', 'Permit type', 'Risk level', 'Effective', 'Expires', 'Description'].map((t) => ({ text: t, color: MUTED, fontSize: 8 })),
          [r.site.wdid || '', p.type || 'California Construction Stormwater Permit', String(r.site.risk_level || ''), p.effective || '', p.expires || '', p.description || ''],
        ],
      },
      layout: grid,
    },
  ];
}

function typeBlock(r) {
  const why = r.types_touched
    ? 'Set by the inspector.'
    : 'Worked out from the NWS forecast and the on-site gauge (Att. D III.C.2-5): ' + typeReasons(r.classified, r.storm_gauge_in, r.tz, !!(r.weather && r.weather.forecast)).join(' ');
  return [
    bar('Type of Inspection'),
    {
      columns: TYPES.map((t) => ({
        width: '*',
        columns: [checkbox(r.types.includes(t.id)), { width: '*', text: t.label, margin: [3, 0, 0, 0] }],
      })),
      columnGap: 10,
    },
    { text: why, fontSize: 7.5, color: MUTED, margin: [0, 5, 0, 0] },
    r.storm_gauge_in !== '' && r.storm_gauge_in !== undefined && r.classified && r.classified.recent
      ? { text: `Site gauge total over the QPE that ended ${fmtLocal(r.classified.recent.end_ms, r.tz)}: ${Number(r.storm_gauge_in).toFixed(2)}"`, fontSize: 8, margin: [0, 2, 0, 0] }
      : '',
  ];
}

function answerCells(q, a) {
  return ['yes', 'no', 'na'].map((o) => {
    if (!q.options.includes(o)) return { text: '' };
    const on = a === o;
    return {
      text: ANSWER_LABEL[o], alignment: 'center', fontSize: 8,
      color: on ? '#fff' : MUTED, bold: on,
      fillColor: on ? (q.bad === o ? RED : '#4a4f5a') : '#eef0f4',
    };
  });
}

function checklistBlocks(r, photoNumbers) {
  const out = [];
  for (const s of SECTIONS) {
    out.push(bar(s.title));
    const body = [];
    if (s.id === 'general') {
      // the old 'NOAA forecast checked?' question, now answered by the attachment itself
      const f = r.weather && r.weather.forecast;
      body.push([
        { text: [{ text: 'NWS forecast checked: ', bold: true }, f ? `pulled ${dt(f.fetched_ms, r.tz)}, attached at the end of this report.` : 'not available on the phone; see Site Weather Information.'], fontSize: 8.5 },
        ...answerCells({ options: ['yes', 'no', 'na'], bad: 'no' }, f ? 'yes' : 'no'),
      ]);
    }
    for (const q of s.questions) {
      const a = r.answers[q.id];
      const text = q.label ? [{ text: q.label + ': ', bold: true }, q.text] : q.text;
      body.push([{ text, fontSize: 8.5 }, ...answerCells(q, a)]);
      const note = q.bad && a === q.bad ? r.notes[q.id] : '';
      const pics = (photoNumbers[q.id] || []).map((n) => `Photo ${n}`).join(', ');
      if (note) body.push([{ text: [{ text: 'Noted: ', bold: true, color: RED }, note, pics ? { text: ` (${pics})`, color: MUTED } : ''], fontSize: 8.5, colSpan: 4, margin: [8, 0, 0, 0] }, '', '', '']);
    }
    out.push({
      table: { widths: ['*', 26, 26, 26], body, dontBreakRows: true },
      layout: { ...rows, vLineWidth: () => 0, paddingLeft: (i) => (i === 0 ? 2 : 1.5), paddingRight: () => 1.5 },
    });
  }
  return out;
}

function siteInfoBlock(r) {
  const si = r.site_info;
  const rowsList = [
    ['Phase of construction', si.phase],
    ['Current construction activities', si.activities],
    ['Approximate area of site exposed', si.area ? `${si.area} ac` : ''],
    ['Activities completed since the last inspection', si.completed],
    ['General weather conditions today', si.weather_today],
    ['On-site rain gauge reading', si.gauge_in === '' || si.gauge_in === undefined ? '' : inches(si.gauge_in)],
    ['Current rain event (start and end)', si.event],
    ['Additional comments and visual monitoring observations', si.comments],
  ];
  return [
    bar('Site Information'),
    {
      table: { widths: [170, '*'], body: rowsList.map(([a, b]) => [{ text: a, color: MUTED }, { text: b || '--' }]) },
      layout: rows,
    },
  ];
}

function samplingBlock(r) {
  const sm = r.sampling;
  if (!sm) return [];
  const tz = r.tz;
  const flagPh = (v) => v !== '' && v !== null && (Number(v) < NAL.ph_low || Number(v) > NAL.ph_high);
  const flagNtu = (v) => v !== '' && v !== null && Number(v) > NAL.ntu;
  const out = [bar('Sampling Log')];
  out.push({
    table: {
      widths: [120, '*'],
      body: [
        ['Sampling event type', sm.event_type],
        ['pH meter', `${sm.ph_meter || '--'}; calibrated ${sm.ph_cal || '--'}`],
        ['Turbidity meter', `${sm.ntu_meter || '--'}; calibrated ${sm.ntu_cal || '--'}`],
        ['Sampler', `${r.inspector.name}, ${r.inspector.title}`],
      ].map(([a, b]) => [{ text: a, color: MUTED }, b]),
    },
    layout: rows,
  });
  if (sm.readings.length) {
    out.push({ text: 'Field pH and turbidity', bold: true, margin: [0, 6, 0, 2] });
    out.push({
      table: {
        widths: ['*', 50, 60, 70],
        body: [
          ['Discharge location', 'pH', 'Turbidity (NTU)', 'Time'].map((t) => ({ text: t, color: MUTED, fontSize: 8 })),
          ...sm.readings.map((x) => [
            x.location,
            { text: x.ph === '' ? '--' : Number(x.ph).toFixed(2), color: flagPh(x.ph) ? RED : INK, bold: flagPh(x.ph) },
            { text: x.ntu === '' ? '--' : String(x.ntu), color: flagNtu(x.ntu) ? RED : INK, bold: flagNtu(x.ntu) },
            x.time_ms ? fmtLocal(x.time_ms, tz, { weekday: undefined, month: undefined, day: undefined }) : '',
          ]),
        ],
      },
      layout: grid,
    });
    const over = sm.readings.filter((x) => flagPh(x.ph) || flagNtu(x.ntu));
    if (over.length) {
      out.push({ text: `Over the numeric action level (pH 6.5 to 8.5, turbidity 250 NTU) at ${over.map((x) => x.location).join(', ')}.`, color: RED, bold: true, margin: [0, 4, 0, 0] });
    }
  }
  if (sm.grabs.length) {
    out.push({ text: 'Grab samples collected', bold: true, margin: [0, 6, 0, 2] });
    out.push({
      table: {
        widths: ['*', 120, 70],
        body: [
          ['Discharge location', 'Sample type', 'Time'].map((t) => ({ text: t, color: MUTED, fontSize: 8 })),
          ...sm.grabs.map((x) => [x.location, x.type, x.time_ms ? fmtLocal(x.time_ms, tz, { weekday: undefined, month: undefined, day: undefined }) : '']),
        ],
      },
      layout: grid,
    });
  }
  if (sm.notes) out.push({ text: [{ text: 'Notes: ', color: MUTED }, sm.notes], margin: [0, 4, 0, 0] });
  return out;
}

function itemsBlock(r, photoNumbers) {
  const out = [bar('Action Items')];
  const tz = r.tz;
  const all = [
    ...r.carried.map((x) => ({ ...x, carried: true })),
    ...r.items.map((x) => ({ ...x, carried: false, status: 'open', date: r.date, inspector: r.inspector.name })),
  ];
  if (!all.length) {
    out.push({ text: 'There are no action items.', color: MUTED });
    return out;
  }
  const late = (x) => x.status === 'open' && x.due && x.due < localDay(r.finished_ms || r.started_ms, tz);
  out.push({
    table: {
      headerRows: 1,
      widths: [80, 52, 46, '*', 70, 52],
      body: [
        ['Item', 'Opened', 'Due', 'Description and location', 'Photos', 'Status'].map((t) => ({ text: t, color: MUTED, fontSize: 8 })),
        ...all.map((x) => [
          { text: [late(x) ? { text: 'LATE  ', color: RED, bold: true } : '', { text: x.title, bold: true }] },
          { text: `${x.date ? day(x.date) : ''}\n${x.inspector || ''}`, fontSize: 7.5 },
          { text: x.due ? day(x.due) : '', fontSize: 8 },
          {
            stack: [
              x.description || '',
              x.location ? { text: x.location, color: MUTED, fontSize: 7.5 } : '',
              x.gps ? { text: `${x.gps.lat.toFixed(5)}, ${x.gps.lon.toFixed(5)}`, link: `https://www.google.com/maps/search/?api=1&query=${x.gps.lat},${x.gps.lon}`, color: BLUE, decoration: 'underline', fontSize: 7.5 } : '',
              x.close_note ? { text: `Closed: ${x.close_note}`, fontSize: 7.5 } : '',
            ],
          },
          { text: [...(photoNumbers[x.id] || []), ...(x.from_q ? photoNumbers[x.from_q] || [] : [])].map((n) => `Photo ${n}`).join(', '), fontSize: 7.5 },
          { text: x.status === 'closed' ? `Closed ${x.closed_on ? day(x.closed_on) : ''}` : 'Open', bold: x.status !== 'closed', color: x.status === 'closed' ? MUTED : INK },
        ]),
      ],
    },
    layout: grid,
    fontSize: 8.5,
  });
  return out;
}

function localDay(ms, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  return p;
}

async function photoBlocks(r, loadPhoto) {
  if (!r.photos.length) return { blocks: [], numbers: {} };
  const tz = r.tz;
  const numbers = {};
  const cells = [];
  for (const [i, p] of r.photos.entries()) {
    const n = i + 1;
    const owner = p.ref && p.ref.split(':')[1];
    if (owner) (numbers[owner] = numbers[owner] || []).push(n);
    const url = await loadPhoto(p);
    const where = p.gps ? `, ${p.gps.lat.toFixed(5)}, ${p.gps.lon.toFixed(5)}` : '';
    cells.push({
      stack: [
        url ? { image: url, fit: [250, 190], alignment: 'center' } : { text: '(photo missing)', color: RED },
        { text: [{ text: `Photo ${n}. `, bold: true }, p.caption || '', { text: `  ${fmtLocal(p.taken_ms, tz, { weekday: undefined })}${where}`, color: MUTED }], fontSize: 7.5, margin: [0, 3, 0, 0] },
      ],
      unbreakable: true,
      margin: [0, 0, 0, 10],
    });
  }
  const body = [];
  for (let i = 0; i < cells.length; i += 2) body.push([cells[i], cells[i + 1] || { text: '' }]);
  return {
    blocks: [
      bar('Photos', 2),
      { table: { widths: ['*', '*'], body, dontBreakRows: true }, layout: 'noBorders' },
    ],
    numbers,
  };
}

function historyBlock(r) {
  const g = r.weather && r.weather.gauges;
  if (!g || !g.gauges.length) return [];
  const dates = g.gauges[0].days.map((d) => d.date);
  return [
    bar('Weather History (nearby public rain gauges)'),
    {
      table: {
        widths: [130, ...dates.map(() => '*')],
        body: [
          [{ text: 'Gauge', color: MUTED }, ...dates.map((d) => ({ text: day(d), alignment: 'center', color: MUTED }))],
          ...g.gauges.map((x) => [
            { text: [{ text: x.name, bold: true }, { text: `\n${x.network}, ${x.miles} mi`, color: MUTED, fontSize: 7 }] },
            ...x.days.map((d) => ({ text: d.in === null ? (d.note === 'later' ? 'in next' : 'M') : d.note === 'trace' ? 'T' : d.in.toFixed(2), alignment: 'center' })),
          ]),
        ],
      },
      layout: grid,
      fontSize: 8,
    },
    {
      text: 'Daily totals in inches from NOAA ACIS (CoCoRaHS, airport and NWS co-op gauges within 15 miles). T = trace, M = missing. Each gauge reports at its own reading hour. The on-site gauge reading is in Site Information.',
      fontSize: 7, color: MUTED, margin: [0, 3, 0, 0],
    },
  ];
}

// the forecast as the inspector's phone pulled it: the NWS forecast in words, then 6-hour chances and
// amounts for five days with the QPE hours marked
function forecastBlock(r) {
  const f = r.weather && r.weather.forecast;
  if (!f || !f.periods) return [];
  const tz = r.tz;
  const hour = (ms) => fmtLocal(ms, tz, { weekday: 'short', month: undefined, day: undefined, minute: undefined });
  const out = [bar('NWS Forecast (as checked)', 2)];
  out.push({ text: `National Weather Service forecast for ${f.near ? 'near ' + f.near : 'the site'} (${f.office} grid ${f.grid}), issued ${f.issued ? dt(Date.parse(f.issued), tz) : '--'}, pulled by the inspector's phone ${dt(f.fetched_ms, tz)}. ${f.source_url}`, fontSize: 7.5, color: MUTED, margin: [0, 0, 0, 6] });
  out.push({
    table: {
      widths: [78, '*'],
      body: f.periods.map((p) => [{ text: p.name, bold: true }, { text: p.detailed || p.short || '' }]),
    },
    layout: rows,
    fontSize: 8,
  });
  if (f.bins && f.bins.length) {
    const groups = [];
    for (let i = 0; i < f.bins.length; i += 10) groups.push(f.bins.slice(i, i + 10));
    out.push({ text: '6-hour chance of rain and forecast amount (inches); shaded = inside a Qualifying Precipitation Event', fontSize: 7.5, color: MUTED, margin: [0, 8, 0, 2] });
    for (const g of groups) {
      const shade = (b) => (b.qpe ? '#fbeceb' : null);
      out.push({
        table: {
          widths: [44, ...g.map(() => '*')],
          body: [
            [{ text: 'Starts', color: MUTED }, ...g.map((b) => ({ text: hour(b.start), alignment: 'center', fillColor: shade(b), fontSize: 6.5 }))],
            [{ text: 'Chance', color: MUTED }, ...g.map((b) => ({ text: b.pop === null ? '--' : `${b.pop}%`, alignment: 'center', fillColor: shade(b) }))],
            [{ text: 'Inches', color: MUTED }, ...g.map((b) => ({ text: b.qpf === null ? '--' : b.qpf.toFixed(2), alignment: 'center', fillColor: shade(b), bold: b.qpe }))],
          ],
        },
        layout: grid,
        fontSize: 7.5,
        margin: [0, 0, 0, 4],
      });
    }
  }
  return out;
}

function signatureBlock(r, sig) {
  const tz = r.tz;
  return [{
    unbreakable: true,
    stack: [
    bar('Certification & Signature', 0),
    {
      columns: [
        {
          width: 230,
          stack: [
            sig ? { image: sig, width: 200 } : { text: '(no signature)', color: RED },
            { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 220, y2: 2, lineWidth: 0.6, lineColor: INK }] },
            { text: 'Electronic signature', fontSize: 7.5, color: MUTED, margin: [0, 2, 0, 0] },
          ],
        },
        {
          width: '*',
          table: {
            widths: [70, '*'],
            body: [
              ['Inspector', r.signature.name],
              ['Title', r.signature.title],
              ['Certification', r.signature.cert || '--'],
              ['Signed', dt(r.signature.signed_ms, tz)],
            ].map(([a, b]) => [{ text: a, color: MUTED }, b]),
          },
          layout: rows,
        },
      ],
      columnGap: 16,
    },
    ],
  }];
}

// report: the inspection record; logo/sig: data URLs; loadPhoto(photo) -> data URL
export async function buildPdf(report, { logo, sig, loadPhoto }) {
  const r = report;
  const date = r.date;
  const footerText = `${r.site.name} - CA SWPPP - ${date}`;
  const photos = await photoBlocks(r, loadPhoto);
  const dd = {
    pageSize: 'LETTER',
    pageBreakBefore: (node) => (node.headlineLevel === 1 && node.startPosition.verticalRatio > 0.88)
      || (node.headlineLevel === 2 && node.startPosition.verticalRatio > 0.66),
    pageMargins: [40, 36, 40, 44],
    defaultStyle: { fontSize: 9, color: INK, lineHeight: 1.12 },
    info: { title: `${r.site.name} - CA SWPPP - ${date}`, author: r.inspector.name, subject: 'SWPPP inspection report', creator: 'Marchell SWPPP Inspect' },
    footer: (page, pages) => ({
      columns: [
        { text: footerText, alignment: 'left' },
        { text: `Page ${page} of ${pages}`, alignment: 'right' },
      ],
      fontSize: 7.5, color: MUTED, margin: [40, 14, 40, 0],
    }),
    content: [
      headerBlock(r, logo),
      { text: 'CA SWPPP Inspection Report', alignment: 'center', bold: true, fontSize: 15, color: BLUE, margin: [0, 12, 0, 0] },
      ...weatherBlock(r),
      ...permitBlock(r),
      ...typeBlock(r),
      ...checklistBlocks(r, photos.numbers),
      ...siteInfoBlock(r),
      ...samplingBlock(r),
      ...itemsBlock(r, photos.numbers),
      ...signatureBlock(r, sig),
      ...photos.blocks,
      ...historyBlock(r),
      ...forecastBlock(r),
    ],
  };
  return new Promise((resolve, reject) => {
    try {
      window.pdfMake.createPdf(dd).getBlob(resolve);
    } catch (e) {
      reject(e);
    }
  });
}
