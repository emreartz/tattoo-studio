import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
let output = 'Installed dependency notices - Tattoo Studio\nGenerated from package-lock.json and installed package license files.\n'
for (const [dir, metadata] of Object.entries(lock.packages).sort()) {
  if (!dir || metadata.dev) continue
  const packageFile = path.join(dir, 'package.json')
  let pkg
  try { pkg = JSON.parse(await readFile(packageFile, 'utf8')) } catch { continue }
  output += `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || JSON.stringify(pkg.licenses) || 'See package license'}\n`
  const files = (await readdir(dir)).filter(name => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name))
  for (const file of files) {
    try { output += `\n${file}\n${await readFile(path.join(dir, file), 'utf8')}\n` } catch { /* Some packages use a license directory. */ }
  }
}
await writeFile('public/licenses/DEPENDENCIES.txt', output)
