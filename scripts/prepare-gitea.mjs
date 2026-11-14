// GitHub stores source and provenance. The npm package includes this verified
// executable; consumers do not download it again at runtime.
import {readFile, mkdir, writeFile, rename, unlink} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const base = new URL('../vendor/gitea/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const target = fileURLToPath(new URL(manifest.file, base));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let valid = false;
try {valid = sha256(await readFile(target)) === manifest.sha256;} catch (error) {if (error.code !== 'ENOENT') throw error;}
if (valid) console.log('Bundled Gitea already matches the pinned SHA-256.');
else {
  const response = await fetch(manifest.source, {signal: AbortSignal.timeout(180000)});
  if (!response.ok) throw new Error(`Gitea download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== manifest.sha256) throw new Error('Downloaded Gitea SHA-256 does not match manifest; no executable was installed.');
  await mkdir(dirname(target), {recursive: true});
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {await writeFile(temporary, bytes, {flag: 'wx'}); await rename(temporary, target);}
  finally {await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});}
  console.log(`Prepared Gitea ${manifest.version} (${manifest.platform}/${manifest.arch})`);
}
