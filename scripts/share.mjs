import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = path.join(root, '.runtime');
const sharedRoot = path.join(runtime, 'public-shared');
const port = Number(process.env.PIXEL_SPRITE_PORT || 4173);
const cloudflared = process.env.CLOUDFLARED_BIN || '/opt/homebrew/bin/cloudflared';
const urlFile = path.join(runtime, process.env.XPC_SERVICE_NAME === 'com.pixel-sprite-animator.share' ? 'share-url' : 'share-url-foreground');
const tokenFile = path.join(runtime, 'tunnel-token');
const hostnameFile = path.join(runtime, 'share-hostname');
const accessKey = process.env.PIXEL_SPRITE_ACCESS_KEY || randomBytes(24).toString('base64url');
await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
await fs.rm(urlFile, { force: true });
await fs.writeFile(path.join(runtime, 'access-key'), `${accessKey}\n`, { mode: 0o600 });
const namedTunnel = await fs.stat(tokenFile).then(stat => stat.isFile()).catch(error => error.code === 'ENOENT' ? false : Promise.reject(error));
const namedUrl = namedTunnel ? (await fs.readFile(hostnameFile, 'utf8')).trim().replace(/\/$/, '') : '';
if (namedTunnel && !/^https:\/\/[^/\s]+$/.test(namedUrl)) throw new Error('命名隧道需要 .runtime/share-hostname 中的 HTTPS 域名');

let server = null;
let ownsServer = false;
let tunnel = null;
let stopping = false;
let reconnectTimer = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function originReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1200) });
    return response.status === 401 || response.status === 200;
  } catch { return false; }
}

async function ensureSharedRoot() {
  try {
    await fs.access(path.join(sharedRoot, 'index.html'));
  } catch {
    await fs.mkdir(sharedRoot, { recursive: true, mode: 0o700 });
    await fs.cp(path.join(root, 'public'), sharedRoot, { recursive: true, force: true, errorOnExist: false });
    console.log(`首次建立公网快照：${sharedRoot}`);
  }
}

async function startOrigin() {
  if (await originReady()) {
    // A previous LaunchAgent instance may still be handing off its child.
    await delay(500);
    if (await originReady()) {
      console.log(`复用已有本机网页服务：http://127.0.0.1:${port}`);
      return;
    }
  }
  server = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root,
    env: { ...process.env, PIXEL_SPRITE_HOST: '127.0.0.1', PIXEL_SPRITE_PORT: String(port), PIXEL_SPRITE_ACCESS_KEY: accessKey, PIXEL_SPRITE_AUTH_DISABLED: '1', PIXEL_SPRITE_PUBLIC_ROOT: sharedRoot },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ownsServer = true;
  server.stdout.on('data', data => process.stdout.write(data));
  server.stderr.on('data', data => process.stderr.write(data));
  server.on('exit', code => {
    if (stopping || !ownsServer) return;
    console.error(`本机网页服务退出 (${code})，共享服务将自动重启`);
    server = null;
    ownsServer = false;
    scheduleReconnect(1000);
  });
  for (let i = 0; i < 50 && !stopping; i++) {
    if (await originReady()) return;
    await delay(200);
  }
  throw new Error(`本机网页服务没有启动；检查 ${port} 端口是否被占用`);
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  tunnel?.kill('SIGTERM');
  if (ownsServer) server?.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

const tunnelArgs = namedTunnel
  ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token-file', tokenFile]
  : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`];

function scheduleReconnect(ms = 2000) {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startOrigin().then(() => startTunnel()).catch(error => { console.error(`共享服务重连失败：${error.message}`); scheduleReconnect(5000); });
  }, ms);
}

function startTunnel() {
  if (stopping || tunnel) return;
  if (namedTunnel) {
    fs.writeFile(urlFile, `${namedUrl}\n`, { mode: 0o600 }).catch(console.error);
    console.log(`命名隧道网页：${namedUrl}`);
  } else {
    fs.rm(urlFile, { force: true }).catch(console.error);
  }
  tunnel = spawn(cloudflared, tunnelArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let tunnelOutput = '';
  const record = data => {
    const message = data.toString();
    process.stdout.write(message);
    tunnelOutput = (tunnelOutput + message).slice(-4000);
    const url = tunnelOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (!namedTunnel && url && url !== record.lastUrl) {
      record.lastUrl = url;
      fs.writeFile(urlFile, `${url}\n`, { mode: 0o600 })
        .then(() => console.log(`分享网页：${url}\n网页访问码位于 ${path.join(runtime, 'access-key')}`))
        .catch(error => console.error(error));
    }
  };
  tunnel.stdout.on('data', record);
  tunnel.stderr.on('data', record);
  tunnel.on('error', error => { console.error(`HTTPS 隧道错误：${error.message}`); });
  tunnel.on('exit', code => {
    tunnel = null;
    if (!stopping) {
      console.error(`HTTPS 隧道退出 (${code})，2 秒后自动重连`);
      scheduleReconnect(2000);
    }
  });
}

await ensureSharedRoot();
await startOrigin();
startTunnel();
