// Minimal CDP harness: launch headless Chrome, stream console/errors, screenshot.
// Usage: node tools/cdp_test.js [url] [waitMs] [outPng]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:8123/main.html?autostart=1';
const waitMs = Number(process.argv[3] || 25000);
const outPng = process.argv[4] || path.join(__dirname, '..', 'docs', 'cdp-shot.png');
const port = 9300 + Math.floor(Math.random() * 300);
const userDir = path.join(process.env.TEMP || '.', 'botw-cdp-' + Date.now());

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--disable-background-timer-throttling',
  '--remote-debugging-port=' + port, '--user-data-dir=' + userDir,
  '--window-size=1600,900', url,
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) {} };
process.on('exit', cleanup);

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJSON('/json/list');
      const page = (list||[]).find(t => t.type === 'page' && (t.url||'').indexOf('main.html') >= 0);
      if (page) { target = page; break; }
    } catch (_) {}
    await sleep(250);
  }
  if (!target) throw new Error('no chrome target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
    const mid = ++id;
    const timer = setTimeout(() => { pending.delete(mid); reject(new Error('CDP timeout: ' + method)); }, timeout);
    pending.set(mid, {
      resolve: v => { clearTimeout(timer); resolve(v); },
      reject: e => { clearTimeout(timer); reject(e); },
    });
    try { ws.send(JSON.stringify({ id: mid, method, params })); } catch (e) { pending.delete(mid); reject(e); }
  });
  const logs = [];
  const errors = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
      const line = msg.params.type + ': ' + args;
      logs.push(line);
      console.log('[console] ' + line);
      if (msg.params.type === 'error') errors.push(args);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const line = (d.exception && d.exception.description) || d.text;
      errors.push(line);
      console.log('[EXCEPTION] ' + line);
    }
    if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response || {};
      if (r.status >= 400) console.log('[http] ' + r.status + ' ' + r.url);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      console.log('[log:' + e.level + '] ' + e.text);
      if (e.level === 'error') errors.push(e.text);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  console.log('[harness] reload ' + target.url);
  await send('Page.reload', { ignoreCache: true });
  const t0 = Date.now();
  let state = null;
  while (Date.now() - t0 < waitMs) {
    await sleep(1000);
    try {
      const r = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          loading: getComputedStyle(document.getElementById('loadingOverlay')||document.body).display,
          loadingOpacity: (document.getElementById('loadingOverlay')||{}).style ? document.getElementById('loadingOverlay').style.opacity : '',
          fill: (document.getElementById('loadFill')||{}).style ? document.getElementById('loadFill').style.width : '',
          status: (document.getElementById('loadStatus')||{}).textContent,
          start: getComputedStyle(document.getElementById('startOverlay')||document.body).display,
          fatal: (document.getElementById('fatalOverlay')||{}).style ? document.getElementById('fatalOverlay').style.display : '',
          fatalMsg: (document.querySelector('#fatalOverlay .fatal-msg')||{}).textContent,
          title: document.title,
          fps: window.__FPS__||null
        })`, returnByValue: true,
      }, 4000);
      state = JSON.parse(r.result.value || '{}');
      console.log('[state] ' + JSON.stringify(state));
      if (state.fatal === 'flex') break;
      if (state.status && state.status.indexOf('完成') >= 0) { await sleep(1500); break; }
    } catch (e) { console.log('[eval] ' + e.message); }
  }
  if(process.env.CDP_EVAL){
    try{
      const ev=await send('Runtime.evaluate',{expression:process.env.CDP_EVAL,returnByValue:true,awaitPromise:true},20000);
      console.log('=== EVAL ===');
      console.log(JSON.stringify(ev.result && ev.result.value,null,2));
    }catch(e){ console.log('[eval] '+e.message); }
  }
  let shot = null;
  try { shot = await send('Page.captureScreenshot', { format: 'png' }, 20000); } catch (e) { console.log('[shot] ' + e.message); }
  if (shot && shot.data) fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
  console.log('=== CONSOLE (last 80) ===');
  console.log(logs.slice(-80).join('\n'));
  console.log('=== ERRORS ===');
  console.log(errors.slice(-20).join('\n') || '(none)');
  console.log('=== SHOT ===');
  console.log(outPng, fs.existsSync(outPng) ? fs.statSync(outPng).size + ' bytes' : 'missing');
  try { ws.close(); } catch (_) {}
  cleanup();
  setTimeout(() => process.exit(errors.length ? 2 : 0), 300);
})().catch(e => { console.error('HARNESS ERROR', e); cleanup(); process.exit(1); });
