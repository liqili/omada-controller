import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--user-data-dir=/tmp/claude-502/chrome-profile-91296'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[console:${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message.slice(0, 500)));
page.on('requestfailed', (r) => console.log('[REQFAIL]', r.url().slice(0,120), r.failure()?.errorText));
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 20000 }).catch(e => console.log('[NAV]', e.message.slice(0,200)));
await new Promise((r) => setTimeout(r, 3000));
console.log('ROOT len:', await page.evaluate(() => document.getElementById('root').innerHTML.length));
console.log('URL now:', page.url());
console.log('BODY text:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
await browser.close();
