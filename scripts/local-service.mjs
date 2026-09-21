import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = path.join(root, '.runtime');
const label = 'com.pixel-sprite-animator.local';
const service = `gui/${process.getuid()}/${label}`;
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const port = 4174;
const key = process.env.PIXEL_SPRITE_ACCESS_KEY || 'local-development-only';
const command = process.argv[2] || 'status';
const nodePath = process.execPath;
const serverPath = path.join(root, 'server.mjs');
const logPath = path.join(runtime, 'local.log');
const errorPath = path.join(runtime, 'local-error.log');
const escapeXml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const run = (...args) => {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim());
  return result.stdout;
};

await fs.mkdir(runtime, { recursive: true, mode: 0o700 });

if (command === 'install') {
  await fs.mkdir(path.dirname(plist), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${escapeXml(nodePath)}</string><string>${escapeXml(serverPath)}</string></array>\n<key>WorkingDirectory</key><string>${escapeXml(root)}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>PIXEL_SPRITE_HOST</key><string>127.0.0.1</string><key>PIXEL_SPRITE_PORT</key><string>${port}</string><key>PIXEL_SPRITE_ACCESS_KEY</key><string>${key}</string><key>PIXEL_SPRITE_PUBLIC_ROOT</key><string>${escapeXml(path.join(root, 'public'))}</string></dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>5</integer>\n<key>StandardOutPath</key><string>${escapeXml(logPath)}</string>\n<key>StandardErrorPath</key><string>${escapeXml(errorPath)}</string>\n</dict></plist>\n`;
  const serviceXml = xml.replace(`<key>PIXEL_SPRITE_ACCESS_KEY</key><string>${key}</string>`, `<key>PIXEL_SPRITE_ACCESS_KEY</key><string>${key}</string><key>PIXEL_SPRITE_AUTH_DISABLED</key><string>1</string>`);
  const existing = await fs.readFile(plist, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing !== serviceXml) {
    try { run('bootout', service); } catch (error) {
      if (!/No such process|Could not find service|Input\/output error/i.test(String(error.message))) throw error;
    }
    await fs.writeFile(plist, serviceXml, { mode: 0o600 });
  }
  try { run('bootstrap', `gui/${process.getuid()}`, plist); } catch (error) {
    try { run('kickstart', '-k', service); }
    catch (restartError) { throw error; }
  }
  console.log(`已安装本地常驻服务：${plist}`);
} else if (command === 'restart') {
  run('kickstart', '-k', service); console.log('本地服务已重启');
} else if (command === 'stop') {
  run('bootout', service); console.log('本地服务已停止');
} else if (command === 'open') {
  spawnSync('open', [`http://127.0.0.1:${port}/`], { stdio: 'ignore' }); console.log(`已打开 http://127.0.0.1:${port}/`);
} else if (!['status', 'install', 'restart', 'stop', 'open'].includes(command)) {
  throw new Error('命令仅支持 install / restart / stop / open / status');
}

if (['status', 'install', 'restart'].includes(command)) {
  const status = spawnSync('launchctl', ['print', service], { encoding: 'utf8' });
  console.log(status.status === 0 && /state = running/.test(status.stdout) ? '本地常驻服务：运行中' : '本地常驻服务：未运行');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(2000) });
    console.log(`本地网页：HTTP ${response.status} · http://127.0.0.1:${port}/`);
  } catch { console.log(`本地网页：未响应 · http://127.0.0.1:${port}/`); }
  console.log(`本地访问码：${key}`);
  console.log(`LaunchAgent：${plist}`);
}
