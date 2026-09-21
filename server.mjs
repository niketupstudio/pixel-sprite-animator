import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(process.env.PIXEL_SPRITE_PUBLIC_ROOT || path.join(root, 'public'));
const port = Number(process.env.PIXEL_SPRITE_PORT || 4173);
const host = process.env.PIXEL_SPRITE_HOST || '127.0.0.1';
const keyPath = path.join(root, '.runtime', 'access-key');
const authDisabled = process.env.PIXEL_SPRITE_AUTH_DISABLED === '1';
const maxRequestBytes = 2_048;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm'
};
const commonHeaders = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY', 'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};

async function accessKey() {
  const configured = process.env.PIXEL_SPRITE_ACCESS_KEY;
  if (configured) {
    if (configured.length < 6) throw new Error('PIXEL_SPRITE_ACCESS_KEY 至少需要 6 个字符');
    return configured;
  }
  await fs.mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(keyPath, randomBytes(24).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await fs.chmod(keyPath, 0o600);
  return (await fs.readFile(keyPath, 'utf8')).trim();
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { ...commonHeaders, ...headers, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function matchesKey(suppliedText, key) {
  const supplied = Buffer.from(suppliedText);
  const expected = Buffer.from(key);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function makeSession(key) {
  const payload = `${(Date.now() + 30 * 24 * 60 * 60 * 1000).toString(36)}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

function validSession(cookie, key) {
  if (!cookie) return false;
  const parts = cookie.split('.');
  if (parts.length !== 3 || !Number.isFinite(parseInt(parts[0], 36)) || parseInt(parts[0], 36) <= Date.now()) return false;
  const expected = createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  return matchesKey(parts[2], expected);
}

function authorized(req, key) {
  if (authDisabled) return true;
  const cookie = /(?:^|;\s*)psa_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (validSession(cookie, key)) return true;
  const match = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0 || decoded.slice(0, separator) !== 'sprite') return false;
  return matchesKey(decoded.slice(separator + 1), key);
}

async function readBody(req, limit = maxRequestBytes) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error(limit === maxRequestBytes ? '上传超过 90 MB，请降低倍率、帧持续时间或循环次数' : '请求过大');
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}

async function serve(req, res, key) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['x-pixel-sprite-request'] !== '1') return json(res, 415, { error: '无效登录请求' });
      const body = JSON.parse(await readBody(req, 2048));
      if (!matchesKey(String(body.accessKey || ''), key)) return json(res, 401, { error: '访问码不正确' });
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.writeHead(204, { ...commonHeaders, 'set-cookie': `psa_session=${makeSession(key)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` });
      return res.end();
    }
    const hasAccess = authorized(req, key);
    if (url.pathname === '/api/logout' && req.method === 'POST' && hasAccess) {
      if (req.headers['x-pixel-sprite-request'] !== '1') return json(res, 415, { error: '无效退出请求' });
      res.writeHead(204, { ...commonHeaders, 'set-cookie': 'psa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return res.end();
    }
    const publicLogin = req.method === 'GET' && ['/', '/login.html', '/login.css', '/login.js'].includes(url.pathname);
    if (!hasAccess && !publicLogin) return json(res, 401, { error: '需要访问码' });
    if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, { ready: true, exportMode: 'browser-local', encoder: 'browser', encoderReady: false, encoderDetail: '浏览器本地导出；服务器不接收视频帧', activeEncodes: 0, maxEncodes: 0 });
    if (['/api/export-mov', '/api/export-gif'].includes(url.pathname)) return json(res, 410, { error: '服务器编码已关闭，请使用浏览器本地导出', code: 'BROWSER_LOCAL_EXPORT_ONLY' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    const pathname = decodeURIComponent(url.pathname === '/' ? (hasAccess ? '/index.html' : '/login.html') : url.pathname);
    const file = path.resolve(publicRoot, `.${pathname}`);
    if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) return json(res, 403, { error: 'Forbidden' });
    const stat = await fs.stat(file);
    if (!stat.isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { ...commonHeaders, 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'content-length': stat.size });
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file), res);
  } catch (error) {
    if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? 'Not found' : 'Bad request' });
  }
}

const key = await accessKey();
http.createServer((req, res) => { serve(req, res, key).catch(error => {
  console.error('Request failed:', error);
  if (!res.headersSent) json(res, 500, { error: '服务器错误' });
}); }).listen(port, host, () => {
  console.log(`Pixel Sprite Animator: http://${host}:${port}`);
  console.log(process.env.PIXEL_SPRITE_ACCESS_KEY ? '访问码来自环境变量' : `访问码文件：${keyPath}`);
});
