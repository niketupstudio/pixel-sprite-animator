import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const key = 'test-access-key-0123456789abcdefghijklmnop';
const authorization = `Basic ${Buffer.from(`sprite:${key}`).toString('base64')}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test('shared app protects every route and keeps export computation in the browser', async t => {
  const port = await freePort();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-sprite-test-'));
  const publicRoot = path.join(dir, 'public-root');
  await fs.cp(path.join(root, 'public'), publicRoot, { recursive: true });
  await fs.writeFile(path.join(publicRoot, 'root-selection.txt'), 'selected-public-root');
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root, env: { ...process.env, PIXEL_SPRITE_PORT: String(port), PIXEL_SPRITE_ACCESS_KEY: key, PIXEL_SPRITE_PUBLIC_ROOT: publicRoot }, stdio: 'ignore'
  });
  t.after(async () => { child.kill('SIGTERM'); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { ready = (await fetch(`${base}/api/status`)).status === 401; if (ready) break; }
    catch { /* Startup is still in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'API starts with authentication');
  const headers = { authorization };
  const loginPage = await fetch(base);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /访问工作台/);
  const loginHeaders = { 'content-type': 'application/json', 'x-pixel-sprite-request': '1' };
  const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: loginHeaders, body: JSON.stringify({ accessKey: 'incorrect' }) });
  assert.equal(wrong.status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: loginHeaders, body: JSON.stringify({ accessKey: key }) });
  assert.equal(login.status, 204);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const browserPage = await fetch(base, { headers: { cookie } });
  assert.equal(browserPage.status, 200);
  const browserHtml = await browserPage.text();
  assert.match(browserHtml, /Sprite Sheet 编辑/);
  assert.match(browserHtml, /导出当前帧 PNG/);
  assert.match(browserHtml, /导出全部动作帧 PNG/);
  assert.match(browserHtml, /导出透明 PNG Sequence/);
  assert.match(browserHtml, /导出透明 GIF/);
  assert.match(browserHtml, /导出透明 MOV/);
  assert.doesNotMatch(browserHtml, /H264|H256PS|MP4/);
  assert.doesNotMatch(browserHtml, /Mac 编码/);
  const expiredPayload = `${(Date.now() - 1000).toString(36)}.test`;
  const expiredCookie = `psa_session=${expiredPayload}.${createHmac('sha256', key).update(expiredPayload).digest('base64url')}`;
  assert.equal((await fetch(`${base}/api/status`, { headers: { cookie: expiredCookie } })).status, 401);
  const page = await fetch(base, { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Pixel Sprite Animator/);
  assert.equal((await fetch(`${base}/app.js`)).status, 401);
  assert.equal((await fetch(`${base}/login.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/gifenc.js`, { headers })).status, 200);
  const ffmpegCore = await fetch(`${base}/vendor/ffmpeg/ffmpeg-core.wasm`, { method: 'HEAD', headers });
  assert.equal(ffmpegCore.status, 200);
  assert.match(ffmpegCore.headers.get('content-type') || '', /application\/wasm/);
  assert.equal((await fetch(`${base}/assets/%E9%9A%86_Ryu_%E5%AE%8C%E6%95%B4%E7%B2%BE%E7%81%B5%E5%9B%BE.png`, { headers })).status, 200);
  assert.equal(await (await fetch(`${base}/root-selection.txt`, { headers })).text(), 'selected-public-root');
  assert.equal((await fetch(`${base}/server.mjs`, { headers })).status, 404);

  const rejected = await fetch(`${base}/api/export-mov`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(rejected.status, 410);
  assert.match(await rejected.text(), /BROWSER_LOCAL_EXPORT_ONLY/);
  const status = await fetch(`${base}/api/status`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).exportMode, 'browser-local');
  const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie, 'x-pixel-sprite-request': '1' } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});
