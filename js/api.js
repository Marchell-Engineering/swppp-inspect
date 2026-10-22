// Talking to the Google script in Brandon's account (gas/Code.gs): sign-in and the site list, and the
// upload queue. Uploads resume where they stopped, so losing signal halfway through costs nothing.
//
// Requests are plain-text POSTs (no CORS preflight), the way Apps Script web apps accept them.

import { BACKEND_URL } from './settings.js';
import { kv, reports, blobs } from './store.js';
import { blobToBase64 } from './media.js';

async function backend() {
  // a test server can stand in for the Google script, but only when the app itself runs on this machine
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  return (local && (await kv.get('backend_override'))) || BACKEND_URL;
}

// What the last request found: the app's signal badge follows real results, not what the phone claims
// (a phone with one bar says it's online while nothing gets through).
export const net = { ok_ms: 0, fail_ms: 0 };

async function call(payload, timeoutMs = 60000) {
  const url = await backend();
  if (!url) throw new Error('No server set up yet');
  try {
    const out = await request(url, payload, timeoutMs);
    net.ok_ms = Date.now();
    return out;
  } catch (e) {
    if (e.name === 'TypeError' || e.name === 'AbortError') {
      net.fail_ms = Date.now();
      throw new Error('no connection yet');
    }
    net.ok_ms = Date.now();
    throw e;
  }
}

async function request(url, payload, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`server said ${r.status}`);
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || 'server refused');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// Sign in with an inspector code; returns and caches { inspector, sites, logo }.
export async function signIn(code) {
  const out = await call({ action: 'config', code: code.trim() }, 30000);
  await kv.set('code', code.trim());
  await kv.set('config', { ...out, fetched_ms: Date.now() });
  return out;
}

// Refresh the site list and each site's open action items, quietly; the cached copy stands if offline.
// Sends the storms this phone has seen forecast (seen: { siteId: [...] }) so every phone shares them.
export async function refreshConfig(seen) {
  const code = await kv.get('code');
  if (!code) return null;
  try {
    const out = await call({ action: 'config', code, seen: seen || {} }, 20000);
    await kv.set('config', { ...out, fetched_ms: Date.now() });
    return out;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// the upload queue

let running = null;

export function pending(all) {
  return all.filter((r) => r.status === 'signed');
}

// Upload every signed report that isn't filed yet. onProgress(report, text) reports each step.
export function flushQueue(onProgress = () => {}) {
  if (!running) {
    running = (async () => {
      const code = await kv.get('code');
      const queue = pending(await reports.all());
      let filed = 0;
      let failed = false;
      for (const r of queue) {
        try {
          await uploadOne(r, code, (t) => onProgress(r, t));
          filed += 1;
        } catch (e) {
          onProgress(r, e.message === 'no connection yet' ? 'No connection yet. It will keep trying.' : `Not filed yet: ${e.message}. It will keep trying.`);
          failed = true;
          break; // no signal for one means none for the rest
        }
      }
      return { filed, failed };
    })().finally(() => { running = null; });
  }
  return running;
}

async function uploadOne(r, code, say) {
  r.upload = r.upload || { begun: false, done: [] };
  if (!r.upload.begun) {
    say('Starting upload');
    await call({ action: 'begin', code, report: r.data, meta: r.meta });
    r.upload.begun = true;
    await reports.put(r);
  }
  const files = r.files || [];
  for (const [i, f] of files.entries()) {
    if (r.upload.done.includes(f.name)) continue;
    say(`Uploading ${i + 1} of ${files.length}`);
    const blob = await blobs.get(f.key);
    if (!blob) throw new Error(`missing ${f.name} on this phone`);
    await call({ action: 'file', code, report_id: r.id, name: f.name, kind: f.kind, mime: blob.type || f.mime, data: await blobToBase64(blob) }, 180000);
    r.upload.done.push(f.name);
    await reports.put(r);
  }
  say('Filing the report');
  const out = await call({ action: 'finish', code, report_id: r.id }, 120000);
  r.status = 'filed';
  r.filed = { at: Date.now(), pdf_url: out.pdf_url || null, folder_url: out.folder_url || null, drafted: !!out.drafted };
  await reports.put(r);
  say('Filed');
  return out;
}
