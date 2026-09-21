import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = path.join(root, '.runtime');
const label = 'com.pixel-sprite-animator.share';
const service = `gui/${process.getuid()}/${label}`;
const domain = `gui/${process.getuid()}`;
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const command = process.argv[2] || 'status';
const escapeXml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const run = (...args) => {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim());
  return result.stdout;
};

if (command === 'install') {
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(plist), { recursive: true });
  const cloudflared = '/opt/homebrew/bin/cloudflared';
  await fs.access(cloudflared);
  const values = ['/usr/bin/caffeinate', '-dimsu', process.execPath, path.join(root, 'scripts', 'share.mjs')].map(value => `<string>${escapeXml(value)}</string>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${values}</array>\n<key>WorkingDirectory</key><string>${escapeXml(root)}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>5</integer>\n<key>StandardOutPath</key><string>${escapeXml(path.join(runtime, 'share.log'))}</string>\n<key>StandardErrorPath</key><string>${escapeXml(path.join(runtime, 'share-error.log'))}</string>\n</dict></plist>\n`;
  const existing = await fs.readFile(plist, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing !== xml) {
    if (existing) {
      try { run('bootout', service); } catch (error) {
        if (!/No such process|Could not find service/i.test(String(error.message))) throw error;
      }
    }
    await fs.writeFile(plist, xml, { mode: 0o600 });
  }
  let bootstrapped = false;
  for (let attempt = 0; attempt < 3 && !bootstrapped; attempt++) {
    try { run('bootstrap', domain, plist); bootstrapped = true; }
    catch (error) {
      if (String(error.message).includes('already bootstrapped')) { bootstrapped = true; break; }
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  console.log(`已安装登录自启：${plist}`);
} else if (command === 'restart') {
  run('kickstart', '-k', service);
  console.log('服务正在重启；临时分享网址可能变化');
} else if (command === 'stop') {
  run('bootout', service);
  console.log('共享服务已停止。下次登录仍会按 LaunchAgent 设置启动。');
} else if (command !== 'status' && command !== 'invite') {
  throw new Error('命令仅支持 install / restart / status / invite / stop');
}

if (command === 'status' || command === 'install' || command === 'invite') {
  const status = spawnSync('launchctl', ['print', service], { encoding: 'utf8' });
  console.log(status.status === 0 && /state = running/.test(status.stdout) ? '运行状态：运行中' : '运行状态：未运行');
  const url = await fs.readFile(path.join(runtime, 'share-url'), 'utf8').catch(() => '尚未获取分享网址');
  console.log(`分享网址：${url.trim()}`);
  if (url.startsWith('https://')) {
    const age = Date.now() - (await fs.stat(path.join(runtime, 'share-url'))).mtimeMs;
    if (age < 45_000) console.log('公网连通：等待新域名传播（约 45 秒）');
    else {
      try {
        const response = await fetch(`${url.trim()}/api/status`, { signal: AbortSignal.timeout(6000) });
        console.log(response.status === 200 ? '公网连通：正常（无需访问码）' : response.status === 401 ? '公网连通：正常（需要访问码）' : `公网连通：异常 HTTP ${response.status}`);
      } catch { console.log('公网连通：暂不可达，请查看 .runtime/share-error.log'); }
    }
  }
  console.log(`网页访问码文件：${path.join(runtime, 'access-key')}`);
  if (command === 'invite') {
    console.log(`访问码：${(await fs.readFile(path.join(runtime, 'access-key'), 'utf8')).trim()}`);
    console.log('请把网址和访问码分别通过私密渠道发送给授权使用者。');
  }
}
