// Weather for an inspection: the NWS gridpoint forecast run through the 2022 CGP QPE rule, and the
// nearby public rain gauges (NOAA ACIS). A port of swppp-weather (.claude/scripts/swppp_weather), kept
// to the same numbers: QPE = 50% PoP with 0.5 in forecast over 24 h, extended by each following 24 h
// with 0.25 in or more (Att. B; one dry period ends it, as swppp-weather does). Both feeds allow calls
// straight from the phone (tested 2026-10-21), so no laptop or server sits in between.

export const QPE_POP = 50;        // percent
export const QPE_QPF = 0.50;      // inches over 24 h
export const QPE_EXTEND = 0.25;   // inches over each following 24 h
export const BIN_HOURS = 6;
const MM_TO_IN = 0.0393701;
const HOUR = 3600e3;

const ACIS_URL = 'https://data.rcc-acis.org/MultiStnData';
export const LOOKBACK_DAYS = 7;
const GAUGE_RADIUS_MI = 15;
const GAUGES_SHOWN = 3;
const GAUGE_FRESH_DAYS = 4;

// ---------------------------------------------------------------------------------------------
// small helpers

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function parseDurationHours(text) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text || '');
  if (!m) return 1;
  const [d, h, mi] = m.slice(1).map((x) => (x ? Number(x) : 0));
  return d * 24 + h + mi / 60;
}

function splitValidTime(valid) {
  const [start, dur] = valid.split('/');
  return [Date.parse(start), dur ? parseDurationHours(dur) : 1];
}

export function fmtLocal(ms, tz, opts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(opts || {}),
  }).format(new Date(ms));
}

export function localDate(ms, tz) {
  // YYYY-MM-DD in the site's time zone
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function getJson(url) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/geo+json,application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`could not fetch ${url}: ${last && last.message}`);
}

// ---------------------------------------------------------------------------------------------
// the gridded forecast in 6-hour bins (swppp-weather build_bins)

function hourlyMap(values, transform = (v) => v) {
  const out = new Map();
  for (const item of values || []) {
    if (item.value === null || item.value === undefined) continue;
    const [start, hours] = splitValidTime(item.validTime);
    for (let h = 0; h < Math.round(hours); h++) out.set(start + h * HOUR, transform(item.value));
  }
  return out;
}

function qpfPerHour(values) {
  // spread each precipitation amount (mm) evenly over the hours it covers
  const out = new Map();
  for (const item of values || []) {
    if (item.value === null || item.value === undefined) continue;
    const [start, hours] = splitValidTime(item.validTime);
    const n = Math.max(1, Math.round(hours));
    const per = Number(item.value) / n;
    for (let h = 0; h < n; h++) {
      const t = start + h * HOUR;
      out.set(t, (out.get(t) || 0) + per);
    }
  }
  return out;
}

function describeWeather(entries) {
  if (!entries || !entries.length) return '';
  const words = [];
  for (const e of entries) {
    if (!e.weather) continue;
    const phrase = [e.coverage, e.intensity, e.weather]
      .map((x) => (x || '').replaceAll('_', ' ')).filter(Boolean).join(' ');
    if (!words.includes(phrase)) words.push(phrase);
  }
  return words.join('; ');
}

export function buildBins(props, tz, days, nowMs) {
  const popH = hourlyMap(props.probabilityOfPrecipitation?.values, Number);
  const qpfH = qpfPerHour(props.quantitativePrecipitation?.values);
  const wxH = hourlyMap(props.weather?.values, describeWeather);

  const d = new Date(nowMs);
  d.setUTCMinutes(0, 0, 0);
  const first = d.getTime() - (d.getUTCHours() % BIN_HOURS) * HOUR;
  const bins = [];
  for (let i = 0; i < (days * 24) / BIN_HOURS; i++) {
    const start = first + i * BIN_HOURS * HOUR;
    const hours = Array.from({ length: BIN_HOURS }, (_, h) => start + h * HOUR);
    const popHour = hours.find((h) => popH.has(h));
    const pop = popHour === undefined ? null : popH.get(popHour);
    const hasQpf = hours.some((h) => qpfH.has(h));
    const qpfMm = hours.reduce((s, h) => s + (qpfH.get(h) || 0), 0);
    const wxHour = hours.find((h) => wxH.get(h));
    bins.push({
      start,
      local_date: localDate(start, tz),
      pop: pop === null ? null : Math.round(pop / 5) * 5,
      qpf: hasQpf ? round2(qpfMm * MM_TO_IN) : null,
      wx: wxHour === undefined ? '' : wxH.get(wxHour),
    });
  }
  return { bins, issued: props.updateTime || null };
}

// ---------------------------------------------------------------------------------------------
// the QPE rule (swppp-weather find_qpes / analyze)

export function sum24(qpf, i) {
  return round2(qpf.slice(i, i + 4).reduce((s, v) => s + (v ?? 0), 0));
}

export function findQpes(pop, qpf) {
  const n = qpf.length;
  const qpes = [];
  let i = 0;
  while (i < n) {
    if ((pop[i] || 0) >= QPE_POP && sum24(qpf, i) >= QPE_QPF) {
      const periods = [{ index: i, total: sum24(qpf, i) }];
      let end = i + 4;
      while (end < n && sum24(qpf, end) >= QPE_EXTEND) {
        periods.push({ index: end, total: sum24(qpf, end) });
        end += 4;
      }
      qpes.push({ start: i, end, periods, total: round2(periods.reduce((s, p) => s + p.total, 0)), pop: pop[i] });
      i = end;
    } else {
      i += 1;
    }
  }
  return qpes;
}

export function analyze(table) {
  const { bins } = table;
  const pop = bins.map((b) => b.pop);
  const qpf = bins.map((b) => b.qpf);
  const qpes = findQpes(pop, qpf).map((q) => {
    const start = bins[q.start].start;
    const end = start + 24 * HOUR * q.periods.length;
    return {
      start_ms: start,
      end_ms: end,
      total: q.total,
      pop: q.pop,
      periods: q.periods.map((p, k) => ({ from_ms: start + 24 * HOUR * k, to_ms: start + 24 * HOUR * (k + 1), total: p.total })),
    };
  });
  const maxPop = Math.max(0, ...pop.filter((p) => p !== null));
  const maxSum = Math.max(0, ...bins.map((_, i) => sum24(qpf, i)));
  const status = qpes.length ? 'qpe' : maxPop >= QPE_POP || maxSum >= QPE_EXTEND ? 'rain' : 'dry';
  return { qpes, status, max_pop: maxPop, max_sum24: maxSum };
}

// ---------------------------------------------------------------------------------------------
// the NWS fetch

export async function fetchForecast(site, nowMs = Date.now()) {
  const point = await getJson(`https://api.weather.gov/points/${site.lat.toFixed(4)},${site.lon.toFixed(4)}`);
  const p = point.properties;
  const tz = p.timeZone || 'America/Los_Angeles';
  const [grid, hourly, text] = await Promise.all([
    getJson(p.forecastGridData),
    getJson(p.forecastHourly).catch(() => null),
    getJson(p.forecast).catch(() => null),
  ]);
  const table = buildBins(grid.properties, tz, 7, nowMs);
  const a = analyze(table);

  // the next 48 hours, the way ComplianceGo's header put it
  const next48 = table.bins.filter((b) => b.start + BIN_HOURS * HOUR > nowMs && b.start < nowMs + 48 * HOUR);
  const pop48 = Math.max(0, ...next48.map((b) => b.pop ?? 0));
  const qpf48 = round2(next48.reduce((s, b) => s + (b.qpf ?? 0), 0));

  let current = null;
  const periods = hourly?.properties?.periods || [];
  const now = periods.find((x) => Date.parse(x.startTime) <= nowMs && nowMs < Date.parse(x.endTime)) || periods[0];
  if (now) current = { temp: now.temperature, unit: now.temperatureUnit, short: now.shortForecast };

  const rel = p.relativeLocation?.properties || {};
  return {
    fetched_ms: nowMs,
    issued: table.issued,
    tz,
    office: p.gridId,
    grid: `${p.gridX},${p.gridY}`,
    near: [rel.city, rel.state].filter(Boolean).join(', '),
    source_url: `https://forecast.weather.gov/MapClick.php?lat=${site.lat.toFixed(4)}&lon=${site.lon.toFixed(4)}`,
    current,
    pop48,
    qpf48,
    status: a.status,
    qpes: a.qpes,
    max_pop: a.max_pop,
    // the forecast by day (local), for the report's forecast table
    days: dailySummary(table.bins, tz),
    // the attachment: the NWS 12-hour forecast in words, and five days of 6-hour bins with the QPE hours marked
    periods: (text?.properties?.periods || []).slice(0, 8).map((x) => ({
      name: x.name, start_ms: Date.parse(x.startTime), short: x.shortForecast, detailed: x.detailedForecast,
      pop: x.probabilityOfPrecipitation ? x.probabilityOfPrecipitation.value : null,
    })),
    bins: table.bins.slice(0, 20).map((b) => ({
      start: b.start, pop: b.pop, qpf: b.qpf, wx: b.wx,
      qpe: a.qpes.some((q) => q.start_ms <= b.start && b.start < q.end_ms),
    })),
  };
}

function dailySummary(bins, tz) {
  const out = [];
  for (const b of bins) {
    let d = out.find((x) => x.date === b.local_date);
    if (!d) out.push((d = { date: b.local_date, pop: 0, qpf: 0 }));
    d.pop = Math.max(d.pop, b.pop ?? 0);
    d.qpf = round2(d.qpf + (b.qpf ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the rain gauges (swppp-weather gauge_data / nearest_gauges)

export function miles(lat1, lon1, lat2, lon2) {
  const r = (x) => (x * Math.PI) / 180;
  const a = Math.sin((r(lat2) - r(lat1)) / 2) ** 2
    + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

export function acisValue(item) {
  // one ACIS daily value [value, reading hour] -> [inches, note, hour]
  // T = trace, M = missing, S = folded into a later multi-day total, a trailing A = a multi-day total
  let val = item;
  let hour = -1;
  if (Array.isArray(item)) [val = 'M', hour = -1] = item;
  val = String(val).trim();
  hour = Number.isFinite(Number(hour)) ? Number(hour) : -1;
  if (val === 'T') return [0, 'trace', hour];
  if (val === 'S') return [null, 'later', hour];
  const multi = val.endsWith('A');
  const n = Number(multi ? val.slice(0, -1) : val);
  if (val === '' || Number.isNaN(n)) return [null, 'missing', hour];
  return [n, multi ? 'multi-day' : '', hour];
}

export function gaugeNetwork(sids) {
  const ids = {};
  for (const sid of sids || []) {
    const cut = sid.lastIndexOf(' ');
    const ident = sid.slice(0, cut);
    const kind = sid.slice(cut + 1);
    if (!(kind in ids)) ids[kind] = ident;
  }
  if ('10' in ids) return ['CoCoRaHS', ids['10']];
  if ('5' in ids || '3' in ids) return ['airport ASOS', ids['5'] || ids['3']];
  if ('2' in ids) return ['NWS co-op', ids['2']];
  return ['public gauge', Object.values(ids)[0] || ''];
}

const UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NNE', 'NNW', 'ENE', 'ESE', 'SSE', 'SSW', 'WNW', 'WSW', 'AP', 'AFB', 'CA']);

export function gaugeName(name) {
  const words = name.split(/\s+/).filter(Boolean)
    .map((w) => (UPPER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  return words.join(' ').replace(/\bMc(\w)/g, (_, c) => 'Mc' + c.toUpperCase());
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nearestGauges(site, raw, sdate) {
  const gauges = [];
  for (const st of raw.data || []) {
    const meta = st.meta || {};
    const ll = meta.ll;
    if (!ll) continue;
    const dist = miles(site.lat, site.lon, ll[1], ll[0]);
    if (dist > GAUGE_RADIUS_MI) continue;
    const days = (st.data || []).map((item, i) => {
      const [inches, note, hour] = acisValue(item && item.length ? item[0] : 'M');
      return { date: addDays(sdate, i), in: inches, note, hour };
    });
    if (!days.slice(-GAUGE_FRESH_DAYS).some((d) => d.note !== 'missing')) continue;
    const [network, id] = gaugeNetwork(meta.sids);
    gauges.push({ name: gaugeName(meta.name || 'gauge'), network, id, miles: Math.round(dist * 10) / 10, days });
  }
  gauges.sort((a, b) => a.miles - b.miles);
  return gauges.slice(0, GAUGES_SHOWN);
}

export async function fetchGauges(site, nowMs = Date.now(), tz = 'America/Los_Angeles', days = LOOKBACK_DAYS) {
  const dlat = GAUGE_RADIUS_MI / 69.0;
  const dlon = dlat / Math.cos((site.lat * Math.PI) / 180);
  const today = localDate(nowMs, tz);
  const sdate = addDays(today, -(days - 1));
  const params = {
    bbox: [site.lon - dlon, site.lat - dlat, site.lon + dlon, site.lat + dlat].map((v) => v.toFixed(3)).join(','),
    sdate, edate: today,
    elems: [{ name: 'pcpn', add: 't' }],
    meta: 'name,ll,sids',
  };
  const raw = await getJson(ACIS_URL + '?params=' + encodeURIComponent(JSON.stringify(params)));
  if (raw.error) throw new Error('ACIS: ' + raw.error);
  return { fetched_ms: nowMs, sdate, edate: today, gauges: nearestGauges(site, raw, sdate) };
}

// the most recent day with measurable rain at the nearest gauge that has one
export function lastRain(gauges) {
  let best = null;
  for (const g of gauges || []) {
    for (const d of g.days) {
      if ((d.in ?? 0) >= 0.01 && (!best || d.date > best.date)) best = { date: d.date, in: d.in, gauge: g.name };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// the storms seen: every QPE any forecast pull has shown, kept 14 days, so the post-QPE inspection can be
// called after the storm has dropped off the forecast. A future QPE a newer forecast no longer shows is
// dropped (the forecast changed); one that had begun stays as history. The Google script keeps the same
// list for all phones (mergeSeen there mirrors this one).

const overlaps = (a, b) => a.start_ms < b.end_ms && b.start_ms < a.end_ms;

export function mergeSeen(seen, fetchedMs, qpes) {
  let out = (seen || []).map((s) => ({ ...s }));
  out = out.filter((s) => s.start_ms <= fetchedMs || qpes.some((q) => overlaps(q, s)));
  for (const s of out) {
    // begun, still shown as running, but this forecast has no QPE there any more: it ended
    if (s.start_ms <= fetchedMs && s.end_ms > fetchedMs && !qpes.some((q) => overlaps(q, s))) s.end_ms = fetchedMs;
  }
  for (const q of qpes) {
    const same = out.find((s) => overlaps(s, q));
    if (same) {
      if (same.start_ms > fetchedMs || q.start_ms < same.start_ms) same.start_ms = q.start_ms;
      same.end_ms = q.end_ms;
      same.total = q.total;
      same.seen_ms = fetchedMs;
    } else {
      out.push({ start_ms: q.start_ms, end_ms: q.end_ms, total: q.total, seen_ms: fetchedMs });
    }
  }
  return out.filter((s) => fetchedMs - s.end_ms < 14 * 24 * HOUR).sort((a, b) => a.start_ms - b.start_ms);
}

// two lists of seen QPEs (this phone's and the server's): one list, newest view of each storm wins
export function unionSeen(a, b) {
  const out = (a || []).map((s) => ({ ...s }));
  for (const q of b || []) {
    const same = out.find((s) => overlaps(s, q));
    if (!same) out.push({ ...q });
    else if ((q.seen_ms || 0) > (same.seen_ms || 0)) Object.assign(same, q);
  }
  return out.sort((x, y) => x.start_ms - y.start_ms);
}

// ---------------------------------------------------------------------------------------------
// the inspection type, worked out the way the permit sets it (Att. D III.C.2-5); the inspector can change it
//   pre     a QPE forecast to start within the next 120 hours
//   during  inside a QPE (an inspection every 24 hours until it ends)
//   post    a QPE ended within the last 96 hours and the on-site gauge caught 0.5 in or more over it
// Any of them also counts as the weekly.

export function classify(nowMs, forecast, seen, stormGaugeIn) {
  const qpes = unionSeen(seen, forecast ? forecast.qpes : []);
  const during = qpes.find((q) => q.start_ms <= nowMs && nowMs < q.end_ms) || null;
  const next = qpes.find((q) => q.start_ms > nowMs && q.start_ms - nowMs <= 120 * HOUR) || null;
  const recent = qpes.filter((q) => q.end_ms <= nowMs && nowMs - q.end_ms <= 96 * HOUR).pop() || null;
  const types = ['weekly'];
  if (next) types.push('pre');
  if (during) types.push('during');
  const gauge = stormGaugeIn === '' || stormGaugeIn === null || stormGaugeIn === undefined ? null : Number(stormGaugeIn);
  if (recent && gauge !== null && gauge >= 0.5) types.push('post');
  return { types, next, during, recent, gauge };
}

// what each site owes, for the sites screen
export function whatsDue(nowMs, forecast, seen, last, tz) {
  const out = [];
  const c = classify(nowMs, forecast, seen, null);
  const lastMs = last && last.date ? Date.parse(last.date + 'T12:00:00') : null;
  const since = (ms) => lastMs !== null && last.date >= localDate(ms, tz);
  const did = (t) => last && (last.types || []).includes(t);
  if (c.during && !(last && last.date === localDate(nowMs, tz))) {
    out.push({ urgent: true, text: `QPE under way: inspect once every 24 h until ${fmtLocal(c.during.end_ms, tz)}` });
  }
  if (c.next && !(since(c.next.start_ms - 120 * HOUR) && did('pre'))) {
    out.push({ urgent: true, qsp: true, text: `Pre-storm inspection due before ${fmtLocal(c.next.start_ms, tz)} (QPE, ${c.next.total.toFixed(2)}")` });
  }
  if (c.recent && !(since(c.recent.end_ms) && did('post'))) {
    out.push({ urgent: true, text: `Post-storm inspection by ${fmtLocal(c.recent.end_ms + 96 * HOUR, tz)} if the site gauge caught 0.5" or more` });
  }
  if (!out.length) {
    const age = lastMs === null ? null : Math.floor((Date.parse(localDate(nowMs, tz) + 'T12:00:00') - lastMs) / (24 * HOUR));
    if (age === null || age >= 7) out.push({ urgent: true, text: 'Weekly inspection due' });
    else out.push({ urgent: false, text: `Weekly due by ${fmtLocal(lastMs + 7 * 24 * HOUR, tz, { hour: undefined, minute: undefined })}` });
  }
  return out;
}

// The rain event line (Att. D III.C.7.c: the estimated beginning of the QPE, its duration, the date it ends,
// and the inches), from the same QPEs the inspection type comes from. Brandon 10/22: make the start and end
// automatic. The inspector can still type over it.
export function eventText(classified, stormGaugeIn, tz, hasForecast) {
  const c = classified || {};
  const when = (ms) => fmtLocal(ms, tz);
  const span = (q) => {
    const bits = [`${Math.round((q.end_ms - q.start_ms) / HOUR)} h`];
    if (typeof q.total === 'number') bits.push(`${q.total.toFixed(2)}" forecast`);
    return bits.join(', ');
  };
  if (c.during) return `QPE under way: began about ${when(c.during.start_ms)}, forecast to end about ${when(c.during.end_ms)} (${span(c.during)}).`;
  const out = [];
  if (c.recent) {
    const g = stormGaugeIn === '' || stormGaugeIn === null || stormGaugeIn === undefined ? null : Number(stormGaugeIn);
    out.push(`Last QPE began about ${when(c.recent.start_ms)} and ended about ${when(c.recent.end_ms)} (${span(c.recent)}${g === null ? '' : `; site gauge ${g.toFixed(2)}"`}).`);
  }
  if (c.next) out.push(`Next QPE forecast to begin about ${when(c.next.start_ms)} and end about ${when(c.next.end_ms)} (${span(c.next)}).`);
  if (out.length) return out.join(' ');
  return hasForecast ? 'None: no QPE under way or forecast within 120 hours, and none on record that ended in the last 96 hours.' : '';
}

// the reasons behind the worked-out type, in words, for the form and the PDF
export function typeReasons(classified, stormGaugeIn, tz, hasForecast) {
  const c = classified || {};
  const out = [];
  if (c.next) out.push(`Pre-storm: a QPE (${c.next.total.toFixed(2)}") is forecast to start ${fmtLocal(c.next.start_ms, tz)}, within 120 hours.`);
  if (c.during) out.push(`During storm: a QPE is under way until ${fmtLocal(c.during.end_ms, tz)}; inspect once every 24 hours.`);
  if (c.recent) {
    const g = stormGaugeIn === '' || stormGaugeIn === null || stormGaugeIn === undefined ? null : Number(stormGaugeIn);
    out.push(g === null
      ? `A QPE ended ${fmtLocal(c.recent.end_ms, tz)}. Enter the site gauge total for it: 0.5" or more makes this the post-storm inspection.`
      : g >= 0.5 ? `Post-storm: the site gauge caught ${g.toFixed(2)}" over the QPE that ended ${fmtLocal(c.recent.end_ms, tz)}.`
        : `The site gauge caught ${g.toFixed(2)}" over the QPE that ended ${fmtLocal(c.recent.end_ms, tz)}: under 0.5", so no post-storm inspection is owed.`);
  }
  if (!out.length) out.push(hasForecast ? 'No QPE forecast within 120 hours, none under way, none ended in the last 96 hours.' : 'Worked out once the forecast is pulled.');
  return out;
}
