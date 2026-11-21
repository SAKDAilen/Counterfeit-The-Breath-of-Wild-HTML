// Capture final v9 screenshots in one headless Chrome session.
// Usage: node tools/capture_v9.js [url]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.argv[2] || 'http://127.0.0.1:8787/main.html';
const port = 9700 + Math.floor(Math.random() * 200);
const userDir = path.join(process.env.TEMP || '.', 'botw-cap-' + Date.now());
const outDir = path.join(__dirname, '..', 'docs');
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
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
  const send = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
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
  for (let i = 0; i < 100; i++) {
    await sleep(700);
    try {
      const r = await send('Runtime.evaluate', {
        expression: 'document.getElementById("loadStatus") && document.getElementById("loadStatus").textContent',
        returnByValue: true,
      });
      if ((r.result && r.result.value || '').includes('完成')) { ready = true; break; }
    } catch (_) {}
  }
  if (!ready) throw new Error('game did not finish loading');
  await sleep(1800);
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, 30000);
    if (!r || !r.data) throw new Error('screenshot failed ' + name);
    const f = path.join(outDir, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('[shot]', f);
  };
  const evalp = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 30000);
    if (r.exceptionDetails) console.log('[eval exception]', JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result && r.result.value;
  };

  // 1. title screen
  await shot('preview-start.png');

  // 2. gameplay
  await evalp('document.getElementById("startOverlay").click(); window.BOTW_DEBUG.setTime(0.635); true');
  await sleep(2000);
  await shot('preview-game.png');

  // 3. journal (main quests)
  await evalp('window.BOTW_DEBUG.openJournal(); document.querySelector("[data-tab=main]").click(); true');
  await sleep(600);
  await shot('v9-journal.png');
  await evalp('window.BOTW_DEBUG.closeJournal(); true');

  // 4. Maz Koshia setup
  await evalp(`(()=>{
    const d=window.BOTW_DEBUG;
    d.quest.divineCleared={water:true,wind:true,fire:true,thunder:true};
    d.quest.stage='ganon';
    d.startDLC();
    for(let i=0;i<12;i++){const dlg=document.getElementById('dialog');if(dlg.style.display==='block')dlg.click();}
    d.monsters.filter(m=>m.dlcCamp!==undefined).forEach(m=>m.state='dead');
    d.updateDLC(0.016);
    for(const sh of d.shrines.filter(s=>s.type==='divine')){
      d.startChampionsSongTrial(sh);
      for(let i=0;i<10;i++){const dlg=document.getElementById('dialog');if(dlg.style.display==='block')dlg.click();}
      d.monsters.filter(m=>m.dlcSong&&m.state!=='dead').forEach(m=>m.state='dead');
      d.updateDLC(0.016);
    }
    d.startMazKoshiaFight();
    for(let i=0;i<12;i++){const dlg=document.getElementById('dialog');if(dlg.style.display==='block')dlg.click();}
    const boss=d.monsters.find(m=>m.type==='mazKoshia');
    if(boss){
      d.setTime(0.48); d.setWeather('clear');
      d.player.pos.set(boss.pos.x-15,d.terrainHeight(boss.pos.x-15,boss.pos.z+5)+0.05,boss.pos.z+5);
      d.player.group.position.copy(d.player.pos);
      d.setCam(-0.55,0.20,13);
    }
    return boss?boss.name:null;
  })()`);
  await sleep(1200);
  await shot('v9-mazkoshia-boss.png');

  console.log('[errors]', errors.length ? errors.join('\n') : '(none)');
  ws.close(); cleanup(); setTimeout(() => process.exit(errors.length ? 2 : 0), 400);
})().catch(e => { console.error('CAPTURE ERROR', e); cleanup(); process.exit(1); });
