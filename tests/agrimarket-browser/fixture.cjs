// Local-only UI harness: real React component/audio, fake orders and no production access.
// Run: node tests/agrimarket-browser/fixture.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
let pending = [];
let offline = false;
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
}
const script = `
sessionStorage.setItem('JRIDE_AGRIMARKET_ACCESS_CODE','LOCAL-FIXTURE');
sessionStorage.setItem('JRIDE_AGRIMARKET_ACCESS_PIN','NOT-A-REAL-PIN');
const NativeAudio = window.Audio;
window.Audio = class extends NativeAudio {
  constructor(...args) { super(...args); for (const event of ['playing','pause','ended','error'])
    this.addEventListener(event, () => { document.querySelector('#audio-state').textContent='Audio: '+event; }); }
};
const modules = {};
function require(name) {
  if (name === 'react') return React;
  if (name === './browserAlerts') return modules['@/lib/agrimarket/browserAlerts'];
  if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, {get: (_,name) => name}) };
  return modules[name];
}
{ const exports = {}; ${compile('lib/agrimarket/browserAlerts.ts')}; modules['@/lib/agrimarket/browserAlerts']=exports; }
{ const exports = {}; ${compile('lib/agrimarket/browserAlertDevice.ts')}; modules['@/lib/agrimarket/browserAlertDevice']=exports; }
{ const exports = {}; ${compile('app/agrimarket/producer/PhoneAlertCheck.tsx')}; modules['./PhoneAlertCheck']=exports; }
{ const exports = {}; ${compile('app/agrimarket/producer/FarmerOrderAlerts.tsx')}; modules.component=exports.default; }
ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(modules.component));
async function scenario(name) { await fetch('/__fixture/'+name, {method:'POST'}); window.dispatchEvent(new Event('focus')); }
document.querySelector('#order').onclick=()=>scenario('order');
document.querySelector('#expire').onclick=()=>scenario('expire');
document.querySelector('#offline').onclick=()=>scenario('offline');
document.querySelector('#online').onclick=()=>scenario('online');
`;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgriMarket local alert verification</title><link rel="stylesheet" href="/fixture.css"></head>
<body style="background:#f6f6ed;color:#123;max-width:720px;margin:24px auto;padding:12px;font-family:Arial">
<h1>Local alert verification</h1><p>Isolated fixture. No real login, orders, push delivery or driver dispatch.</p>
<p id="audio-state">Audio: idle</p><button id="order">Simulate pending order</button>
<button id="expire">Expire simulated order</button><button id="offline">Simulate offline</button>
<button id="online">Restore connection</button><p><a href="/agrimarket/producer/products">Products test page</a></p>
<div id="root"></div><article id="agri-order-AG-FIXTURE-001"><h2>Order review target</h2></article>
<script src="/react.js"></script><script src="/react-dom.js"></script><script src="/fixture.js"></script></body></html>`;
http.createServer((req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3184');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname.startsWith('/__fixture/') && req.method==='POST') {
    const name = url.pathname.split('/').pop();
    if (name==='order') pending=[{order_code:'AG-FIXTURE-001',producer_confirm_expires_at:new Date(Date.now()+120000).toISOString()}];
    if (name==='expire') pending=[];
    if (name==='offline') offline=true;
    if (name==='online') offline=false;
    res.end('OK'); return;
  }
  if (url.pathname==='/api/agrimarket/producer/alerts') {
    res.setHeader('Content-Type','application/json'); res.statusCode=offline?503:200;
    res.end(JSON.stringify({ok:!offline,server_time:new Date().toISOString(),orders:pending,push_available:false,public_key:null,subscription:null})); return;
  }
  const assets = {
    '/react.js':'node_modules/react/umd/react.development.js',
    '/react-dom.js':'node_modules/react-dom/umd/react-dom.development.js',
    '/fixture.css':'app/agrimarket/producer/farmer.module.css',
    '/sounds/vendor-order-alert.mp3':'public/sounds/vendor-order-alert.mp3',
  };
  if (assets[url.pathname]) {
    res.setHeader('Content-Type',url.pathname.endsWith('.mp3')?'audio/mpeg':url.pathname.endsWith('.css')?'text/css':'text/javascript');
    res.end(fs.readFileSync(path.join(root,assets[url.pathname]))); return;
  }
  if (url.pathname==='/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(script); return; }
  if (url.pathname==='/agrimarket-alerts-sw.js') { res.statusCode=404; res.end('Push deliberately unavailable in this fixture'); return; }
  res.setHeader('Content-Type','text/html'); res.end(html);
}).listen(3184,'127.0.0.1',()=>console.log('Local-only alert fixture: http://127.0.0.1:3184/agrimarket/producer'));
