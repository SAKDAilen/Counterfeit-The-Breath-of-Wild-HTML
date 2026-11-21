// Visual check harness: start game, apply setups, capture posed screenshots.
// Env:
//   SHOT_POSES = JSON [{name,x,z,yaw,pitch,dist,time,setup}] (x/z optional; player kept otherwise)
//   SHOT_WAIT  = ms to wait after each pose (default 1200)
//   SHOT_PRE   = JS executed once after game start (before poses)
//   SHOT_AFTER = JS executed once after all poses
// Usage: node tools/shot_check.js [url]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.argv[2] || 'http://127.0.0.1:8787/main.html';
const port = 9700 + Math.floor(Math.random() * 200);
const userDir = path.join(process.env.TEMP || '.', 'botw-shot-' + Date.now());
const outDir = path.join(__dirname, '..', 'docs', 'shots');
fs.mkdirSync(outDir, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--disable-background-timer-throttling',
  '--remote-debugging-port=' + port, '--user-data-dir=' + userDir,
  '--window-size=1600,900', base,
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) {} };
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = pathname => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
});

(async () => {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await getJSON('/json/list');
      const p = (list || []).find(t => t.type === 'page' && (t.url || '').includes('main.html'));
      if (p) { target = p; break; }
    } catch (_) {}
    await sleep(250);
  }
  if (!target) throw new Error('no chrome target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  const send = (method, params = {}, timeout = 60000) => new Promise((resolve, reject) => {
    const mid = ++id;
    const timer = setTimeout(() => { pending.delete(mid); reject(new Error('timeout ' + method)); }, timeout);
    pending.set(mid, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    try { ws.send(JSON.stringify({ id: mid, method, params })); } catch (e) { pending.delete(mid); reject(e); }
  });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push((msg.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(700);
    try {
      const r = await send('Runtime.evaluate', {
        expression: 'document.getElementById("loadStatus") && document.getElementById("loadStatus").textContent',
        returnByValue: true,
      });
      if ((r.result && r.result.value || '').includes('完成')) { ready = true; break; }
    } catch (_) {}
  }
  if (!ready) throw new Error('game did not finish loading :: ' + errors.join(' || '));
  await sleep(1500);
  const evalp = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 120000);
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result && r.result.value;
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, 60000);
    if (!r || !r.data) throw new Error('screenshot failed ' + name);
    const f = path.join(outDir, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('[shot]', f);
  };

  await evalp('document.getElementById("startOverlay").click(); true');
  await sleep(1200);
  if (process.env.SHOT_PRE) { console.log('[pre]', await evalp(process.env.SHOT_PRE)); await sleep(600); }

  let poses = [];
  try { poses = JSON.parse(process.env.SHOT_POSES || '[]'); } catch (e) { console.error('bad SHOT_POSES', e.message); }
  if (!poses.length) poses = [{ name: 'default' }];
  const wait = Number(process.env.SHOT_WAIT || 1200);
  for (const p of poses) {
    const js = `(()=>{ const D=window.BOTW_DEBUG; const p=${JSON.stringify(p)};
      if(p.time!==undefined) D.setTime(p.time);
      if(p.weather) D.setWeather(p.weather);
      if(p.x!==undefined&&p.z!==undefined){
        const y=D.terrainHeight(p.x,p.z);
        D.player.pos.set(p.x,y+0.05,p.z); D.player.vel.set(0,0,0);
        D.player.group.position.copy(D.player.pos);
      }
      if(p.yaw!==undefined) D.setCam(p.yaw,p.pitch!==undefined?p.pitch:0.16,p.dist!==undefined?p.dist:8.5);
      ${p.setup || ''}
      return {pos:D.player.pos.toArray()};
    })()`;
    const v = await evalp(js);
    await sleep(wait);
    await shot(p.name);
    console.log('[pose]', p.name, JSON.stringify(v));
  }
  if (process.env.SHOT_AFTER) { console.log('[after]', await evalp(process.env.SHOT_AFTER)); }
  console.log('[errors]', errors.length ? errors.join('\n') : '(none)');
  ws.close(); cleanup(); setTimeout(() => process.exit(errors.length ? 2 : 0), 400);
})().catch(e => { console.error('SHOT ERROR', e); cleanup(); process.exit(1); });
