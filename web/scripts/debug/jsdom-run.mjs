// One-off diagnostic: execute the production bundle served by the web-ui container
// inside jsdom (classic script, since jsdom cannot run type=module), then inspect #root.
import { JSDOM, VirtualConsole } from 'jsdom';
import { MessageChannel as NodeMC } from 'node:worker_threads';

const html = await (await fetch('http://localhost:8080/')).text();
const js = await (await fetch('http://localhost:8080/assets/index-BUFlTpZt.js')).text();

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.log('[JSDOM-EXC]', String(e.stack || e).slice(0, 1200)));
vc.sendTo(console, { omitJSDOMErrors: false });

const patched = html.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '<script id="app"></script>');
const dom = new JSDOM(patched, { url: 'http://localhost:8080/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;

// React's scheduler uses MessageChannel but never calls port.start().
// Node's worker_threads MessagePort does not auto-dispatch until start(),
// so wrap it to auto-start whenever a handler is attached.
class AutoStartMC {
  constructor() {
    const ch = new NodeMC();
    for (const port of [ch.port1, ch.port2]) {
      let handler = null;
      Object.defineProperty(port, 'onmessage', {
        get: () => handler,
        set: (fn) => { handler = fn; port.start(); },
        configurable: true,
        enumerable: true,
      });
      const addEL = port.addEventListener.bind(port);
      port.addEventListener = (type, fn, opts) => { addEL(type, fn, opts); port.start(); };
    }
    this.port1 = ch.port1;
    this.port2 = ch.port2;
  }
}
w.MessageChannel = AutoStartMC;

try {
  const mounted = js.replace('op.createRoot(document.getElementById', 'console.log(\"MOUNT REACHED\");op.createRoot(document.getElementById'); console.log('instrumented:', mounted.length !== js.length); w.eval(mounted);
  console.log('eval ok');
} catch (e) {
  console.log('[THROW]', String(e.message).slice(0, 300));
}

const root = w.document.getElementById('root');
for (const t of [100, 500, 2000]) {
  await new Promise((r) => setTimeout(r, t));
  console.log('root len:', root.innerHTML.length);
}
console.log('inputs:', root.querySelectorAll('input').length, 'buttons:', root.querySelectorAll('button').length);
console.log('text:', root.textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
process.exit(0);
