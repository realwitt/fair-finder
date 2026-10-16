import { chromium, devices } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: { latitude: 35.79485, longitude: -78.7093, accuracy: 9 }, permissions: ['geolocation','accelerometer','gyroscope','magnetometer'] });
const p = await ctx.newPage(); await p.goto((process.env.U||'https://fairfinder.birbol.com/')+'?ll=35.79485,-78.70930&z=19'); await p.waitForTimeout(4000);
await p.evaluate(() => document.getElementById('tglFair').click()); await p.click('#btnLocate'); await p.waitForFunction(() => __ff.compassListening, null, { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(300);
await p.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 40; window.dispatchEvent(e); }); await p.waitForTimeout(300);
await ctx.setGeolocation({ latitude: 35.79486, longitude: -78.70931, accuracy: 12 }); await p.waitForTimeout(350);
await p.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 40; window.dispatchEvent(e); }); await p.waitForTimeout(400);
await p.screenshot({ path: '/workspace/fair-finder-shots/26-v71-you-marker.png', clip: { x: 96, y: 230, width: 200, height: 200 } });
await b.close();
