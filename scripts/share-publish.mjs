import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'public');
const runtime = path.join(root, '.runtime');
const target = path.join(runtime, 'public-shared');
const next = path.join(runtime, `public-shared.next-${process.pid}`);
const backup = path.join(runtime, `public-shared.previous-${process.pid}`);

await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
await fs.rm(next, { recursive: true, force: true });
await fs.rm(backup, { recursive: true, force: true });
await fs.cp(source, next, { recursive: true, force: true, errorOnExist: false });

const existing = await fs.stat(target).then(stat => stat.isDirectory()).catch(() => false);
if (existing) await fs.rename(target, backup);
await fs.rename(next, target);
if (existing) await fs.rm(backup, { recursive: true, force: true });

async function countFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) total += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  return total;
}

console.log(`已发布本地版本到公网快照：${target}`);
console.log(`发布文件数：${await countFiles(target)}`);
console.log('公网不会再随 public/ 的本地修改自动变化。需要更新时再次运行 npm run share:publish。');
