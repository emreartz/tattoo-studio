import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
async function walk(dir) {
  const paths = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`
    if (entry.isDirectory()) paths.push(...await walk(file))
    else paths.push(file)
  }
  return paths
}
const files = (await walk('dist')).filter(p => !p.endsWith('/sw.js'))
const hash = createHash('sha256')
for (const p of files.sort()) hash.update(await readFile(p))
const version = hash.digest('hex').slice(0, 16)
await writeFile('dist/sw.js', `const CACHE='tattoo-studio-${version}';
const FILES=${JSON.stringify(files.map(p => './' + p.slice(5)))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tattoo-studio-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(caches.open(CACHE).then(async cache=>{
  const cached=await cache.match(event.request); if(cached)return cached;
  try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response}catch(error){
   if(event.request.mode==='navigate')return await cache.match(new URL('./index.html',self.location).href);
   throw error;
  }
 }));
});`)
