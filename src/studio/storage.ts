import type { RegionShape } from '@/editor/polygon/RegionShape'

export interface ImageAsset { id: string; name: string; data: string; width: number; height: number }
export interface GeometryData { position: number[]; uv: number[]; index: number[] | null }
export interface MeshData { geometry: GeometryData; position: number[]; quaternion: number[]; scale: number[] }
export interface PieceData {
  id: string; assetId: string; kind: 'regionMesh' | 'drapedPatch'; shape: RegionShape
  mesh: MeshData; flat?: MeshData; opacity: number; contrast: number
}
export interface Composition {
  format: 'tattoo-studio'; version: 1; id: string; name: string; updatedAt: number
  skinTone?: number
  assets: ImageAsset[]; pieces: PieceData[]; camera: { position: number[]; target: number[] }
}

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tattoo-studio', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(new Error('Local storage is unavailable. Export your project to keep a copy.')) }
    request.onblocked = () => reject(new Error('Close other Tattoo Studio tabs and try again.'))
  })
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode)
    const request = run(tx.objectStore('projects'))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(new Error('Could not save locally. Storage may be full. Export a portable project now.'))
  })
}
export const projectStorage = {
  list: () => transaction('readonly', s => s.getAll()) as Promise<Composition[]>,
  put: (project: Composition) => transaction('readwrite', s => s.put(project)),
  delete: (id: string) => transaction('readwrite', s => s.delete(id)),
}
export function newComposition(existing: Pick<Composition, 'name'>[] = []): Composition {
  const highest = existing.reduce((max, project) => {
    const match = /^TattooStudioWorks-(\d+)$/.exec(project.name)
    const number = match ? Number(match[1]) : 0
    return Number.isSafeInteger(number) ? Math.max(max, number) : max
  }, 0)
  return { format: 'tattoo-studio', version: 1, id: crypto.randomUUID(), name: `TattooStudioWorks-${highest + 1}`, updatedAt: Date.now(), assets: [], pieces: [], camera: { position: [1.4, 0.45, 3.35], target: [0, 0, 0] } }
}
export async function readPNG(file: File): Promise<ImageAsset> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: maximum image size is 25 MB.`)
  const header = await file.slice(0, 24).arrayBuffer()
  const signature = new Uint8Array(header).slice(0, 8)
  if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error(`${file.name}: choose a PNG image.`)
  if (header.byteLength < 24) throw new Error('Invalid PNG header.')
  const view = new DataView(header), width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 33554432) throw new Error('Images must be at most 8192 pixels per side and 32 megapixels.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(new Blob([file], { type: 'image/png' }))
  })
  const image = await decodeImage(data)
  return { id: crypto.randomUUID(), name: file.name, data, width: image.naturalWidth, height: image.naturalHeight }
}
export async function decodeImage(data: string) {
  const header = Uint8Array.from(atob(data.split(',')[1].slice(0, 32)), c => c.charCodeAt(0))
  if (header.length < 24) throw new Error('Invalid PNG header.')
  const view = new DataView(header.buffer), width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 33554432) throw new Error('Images must be at most 8192 pixels per side and 32 megapixels.')
  const image = new Image()
  image.src = data
  await image.decode().catch(() => { throw new Error('This image could not be decoded. Choose a valid PNG.') })
  if (!image.naturalWidth || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 33554432) throw new Error('Images must be at most 8192 pixels per side and 32 megapixels.')
  return image
}
export function validateProject(value: unknown): Composition {
  const p = value as Composition
  const fail = () => { throw new Error('Invalid or unsupported Tattoo Studio project. No changes were made.') }
  const numbers = (a: unknown, count?: number): a is number[] => Array.isArray(a) && (count === undefined || a.length === count) && a.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)
  const mesh = (m: MeshData) => {
    if (!m || !numbers(m.position, 3) || !numbers(m.quaternion, 4) || !numbers(m.scale, 3) || m.scale.some(n => n <= 0 || n > 10)) fail()
    const g = m.geometry
    if (!g || !numbers(g.position) || g.position.length < 9 || g.position.length > 300000 || g.position.length % 3 || !numbers(g.uv, g.position.length / 3 * 2)) fail()
    if (g.index !== null && (!numbers(g.index) || g.index.length > 600000 || g.index.length % 3 || g.index.some(n => !Number.isInteger(n) || n < 0 || n >= g.position.length / 3))) fail()
  }
  if (!p || p.format !== 'tattoo-studio' || p.version !== 1 || typeof p.name !== 'string' || p.name.length > 120 || !Array.isArray(p.assets) || p.assets.length > 100 || !Array.isArray(p.pieces) || p.pieces.length > 100) fail()
  if (p.skinTone !== undefined && (typeof p.skinTone !== 'number' || !Number.isFinite(p.skinTone) || p.skinTone < 0 || p.skinTone > 1)) fail()
  const ids = new Set<string>()
  for (const a of p.assets) {
    if (!a || typeof a.id !== 'string' || ids.has(a.id) || typeof a.name !== 'string' || a.name.length > 255 || typeof a.data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a.data) || a.data.length > 35000000 || !numbers([a.width, a.height]) || a.width <= 0 || a.height <= 0 || a.width > 8192 || a.height > 8192) fail()
    ids.add(a.id)
  }
  const pieceIds = new Set<string>()
  for (const piece of p.pieces) {
    if (!piece || typeof piece.id !== 'string' || pieceIds.has(piece.id) || !ids.has(piece.assetId) || !['regionMesh', 'drapedPatch'].includes(piece.kind) || !numbers([piece.opacity, piece.contrast]) || piece.opacity < 0 || piece.opacity > 1 || piece.contrast < 0 || piece.contrast > 4) fail()
    pieceIds.add(piece.id)
    const shape = piece.shape
    if (!shape || !['aarect', 'polygon'].includes(shape.kind) || !Array.isArray(shape.points) || shape.points.length < 2 || shape.points.length > 1000 || (shape.kind === 'aarect' && shape.points.length !== 2) || shape.points.some(pt => !pt || !numbers([pt.x, pt.y]) || pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1)) fail()
    mesh(piece.mesh)
    if (piece.flat) mesh(piece.flat)
    if (piece.kind === 'drapedPatch' && !piece.flat) fail()
  }
  if (!p.camera || !numbers(p.camera.position, 3) || !numbers(p.camera.target, 3)) fail()
  return p
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
