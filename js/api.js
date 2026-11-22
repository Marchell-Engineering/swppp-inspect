// Talking to the Google script in Brandon's account (gas/Code.gs): sign-in and the site list, and the
// upload queue. Uploads resume where they stopped, so losing signal halfway through costs nothing.
//
// Requests are plain-text POSTs (no CORS preflight), the way Apps Script web apps accept them.

import { BACKEND_URL } from './settings.js';
import { kv, reports, blobs } from './store.js';
import './upload_core.js';

const U = self.SwpppUpload;

async function backend() {
  // a test server can stand in for the Google script, but only when the app itself runs on this machine
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  return (local && (await kv.get('backend_override'))) || BACKEND_URL;
}

// What the last request found: the app's signal badge follows real results, not what the phone claims
// (a phone with one bar says it's online while nothing gets through).
export const net = { ok_ms: 0, fail_ms: 0 };

async function call(payload, timeoutMs = 60000, signal = null) {
  const url = await backend();
  if (!url) throw new Error('No server set up yet');
  try {
    const out = await U.post(url, payload, timeoutMs, signal);
    net.ok_ms = Date.now();
    return out;
  } catch (e) {
    if (signal && signal.aborted) throw e;   // handed to the background, not a signal problem
    if (e.name === 'TypeError' || e.name === 'AbortError') {
      net.fail_ms = Date.now();
      throw new Error('no connection yet');
    }
    net.ok_ms = Date.now();
    throw e;
  }
}

// What this app version can do, so the script holds back sites an older phone would mishandle (Code.gs configFor)
const CAN = ['bank', 'history', 'items', 'qspfix'];

// Sign in with an inspector code; returns and caches { inspector, sites, logo }.
export async function signIn(code) {
  const out = await call({ action: 'config', code: code.trim(), can: CAN }, 30000);
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
    const out = await call({ action: 'config', code, seen: seen || {}, can: CAN }, 20000);
    await kv.set('config', { ...out, fetched_ms: Date.now() });
    return out;
  } catch (e) {
    return null;
  }
}

// One past report's PDF from the site's history, as a Blob and its file name.
export async function historyPdf(siteId, pdf) {
  const code = await kv.get('code');
  const out = await call({ action: 'history_pdf', code, site_id: siteId, pdf }, 90000);
  const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
  return { name: out.name, blob: new Blob([bytes], { type: 'application/pdf' }) };
}

// A delegate's report for a QSP to correct (Brandon, 11/20): its newest record and photo list, then each photo as a Blob.
export async function qspSource(siteId, key) {
  const code = await kv.get('code');
  return call({ action: 'qsp_source', code, site_id: siteId, key }, 60000);
}

export async function qspPhoto(siteId, key, fileId) {
  const code = await kv.get('code');
  const out = await call({ action: 'qsp_file', code, site_id: siteId, key, file_id: fileId }, 90000);
  const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}

// Any other request made with this phone's code (phone alerts: push_on, push_off, push_test).
export async function act(action, extra = {}) {
  const code = await kv.get('code');
  return call({ action, code, ...extra }, 30000);
}

// The offline layer (sw.js) asks the script for alert words when a push wakes the phone; it can't read
// settings.js, so the address is kept where it can.
export async function rememberBackend() {
  try { await kv.set('backend_url', await backend()); } catch (e) { /* storage blocked: alerts show a plain note */ }
}

// ---------------------------------------------------------------------------------------------
// the upload queue

let running = null;

export function pending(all) {
  return all.filter((r) => r.status === 'signed');
}

// Upload every signed report that isn't filed yet. onProgress(report, text) reports each step. `signal` stops it
// between steps (the app going to the background hands the rest to the offline layer, sw.js). Returns
// { filed, failed, busy, handed }: busy when the background already holds the upload.
export function flushQueue(onProgress = () => {}, signal = null) {
  if (!running) {
    running = U.withLock(0, async (held) => {
      if (!held) return { filed: 0, failed: false, busy: true };
      const code = await kv.get('code');
      const io = {
        code,
        call: (payload, ms) => call(payload, ms, signal),
        getReport: (id) => reports.get(id),
        putReport: (r) => reports.put(r),
        getBlob: (k) => blobs.get(k),
        stop: () => !!(signal && signal.aborted),
      };
      const queue = pending(await reports.all());
      let filed = 0;
      for (const r of queue) {
        try {
          if (await U.uploadOne(r.id, io, (t) => onProgress(r, t))) filed += 1;
        } catch (e) {
          if (signal && signal.aborted) return { filed, failed: false, handed: true };
          onProgress(r, e.message === 'no connection yet' ? 'No connection yet. It will keep trying.' : `Not filed yet: ${e.message}. It will keep trying.`);
          return { filed, failed: true }; // no signal for one means none for the rest
        }
      }
      return { filed, failed: false };
    }).finally(() => { running = null; });
  }
  return running;
}

// Ask the offline layer to upload in the background (Chrome on Android); a phone without it does nothing.
export async function askBackgroundUpload() {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!reg.sync) return false;
    await reg.sync.register(U.SYNC_TAG);
    return true;
  } catch (e) {
    return false;
  }
}
