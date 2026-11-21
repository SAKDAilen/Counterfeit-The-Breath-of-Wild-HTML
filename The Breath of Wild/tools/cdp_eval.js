// CDP eval helper: node tools/cdp_eval.js "<js expression>" [url] [waitMs]
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const expr = process.argv[2] || '1+1';
const url = process.argv[3] || 'http://127.0.0.1:8123/main.html?autostart=1';
const waitMs = Number(process.argv[4] || 12000);
const port = 9700 + Math.floor(Math.random() * 200);
const userDir = (process.env.TEMP || '.') + '\\botw-eval-' + Date.now();
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--remote-debugging-port=' + port,
  '--user-data-dir=' + userDir, '--window-size=1600,900', url], { stdio: 'ignore' });
const killAll = () => { try { chrome.kill('SIGKILL'); } catch (_) {} };
process.on('exit', killAll);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = pathname => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
});
(async () => {
  let target = null;
  for (let i = 0; i < 60; i++) {
    try { const list = await getJSON('/json/list'); const p = (list || []).find(t => t.type === 'page' && (t.url || '').includes('main.html')); if (p) { target = p; break; } } catch (_) {}
    await sleep(250);
  }
  if (!target) throw new Error('no target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
    const mid = ++id; const timer = setTimeout(() => { pending.delete(mid); reject(new Error('timeout ' + method)); }, timeout);
    pending.set(mid, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  for(let i=0;i<4;i++){ try{ await send('Runtime.enable',{},60000); console.log('runtime enabled'); break; }catch(e){ console.log('retry Runtime.enable',i,e.message); await sleep(2000); } }
  await send('Page.enable',{},20000).catch(()=>{});
  const t0 = Date.now(); let ready = false;
  while (Date.now() - t0 < waitMs) {
    await sleep(700);
    try {
      const r = await send('Runtime.evaluate', { expression: 'window.BOTW_DEBUG && document.getElementById("loadingOverlay").style.opacity==="0"', returnByValue: true }, 3000);
      if (r.result && r.result.value) { ready = true; break; }
    } catch (_) {}
  }
  await sleep(3000);
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 20000);
  console.log('ready:', ready);
  console.log(JSON.stringify(r.result && r.result.value, null, 2));
  if (r.exceptionDetails) console.log('EXC', JSON.stringify(r.exceptionDetails, null, 2));
  ws.close(); killAll(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('ERR', e); killAll(); process.exit(1); });
