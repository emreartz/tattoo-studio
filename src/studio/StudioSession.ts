import { Editor } from '@/editor/main/Editor'
import { MeshSnapshot, snapshotMesh } from '@/editor/main/MeshSnapshot'
import { Piece } from '@/editor/main/PlacedMeshList'
import { RegionMeshFactory } from '@/editor/main/RegionMeshFactory'
import { UpdatePlacedMeshCommand } from '@/editor/main/commands/UpdatePlacedMeshCommand'
import { Color, BufferGeometry, Float32BufferAttribute, Mesh, Quaternion, Raycaster, SRGBColorSpace, Texture, Vector2, Vector3 } from 'three'
import { Composition, decodeImage, download, ImageAsset, MeshData, newComposition, projectStorage, readPNG, validateProject } from './storage'

const fullImage = { kind: 'aarect' as const, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] as [{ x: number; y: number }, { x: number; y: number }] }
function packMesh(m: Mesh | MeshSnapshot): MeshData {
  return { geometry: { position: Array.from(m.geometry.attributes.position.array), uv: Array.from(m.geometry.attributes.uv.array), index: m.geometry.index ? Array.from(m.geometry.index.array) : null }, position: m.position.toArray(), quaternion: m.quaternion.toArray(), scale: m.scale.toArray() }
}
function unpackMesh(d: MeshData): MeshSnapshot {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(d.geometry.position, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(d.geometry.uv, 2))
  if (d.geometry.index) geometry.setIndex(d.geometry.index)
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  return { geometry, position: new Vector3().fromArray(d.position), quaternion: new Quaternion().fromArray(d.quaternion), scale: new Vector3().fromArray(d.scale) }
}

export class StudioSession {
  project = newComposition()
  projects: Composition[] = []
  status = 'Opening local projects…'
  error = ''
  busy = false
  placementAssetId: string | null = null
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private saveQueue = Promise.resolve()
  private revision = 0
  private savedRevision = -1
  private changing = false
  private disposed = false
  private unsubscribers: (() => void)[] = []
  private textures = new Map<string, Texture>()
  constructor(public editor: Editor) {}
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  notify = () => { for (const cb of this.listeners) cb() }
  report = (error: unknown) => { this.error = error instanceof Error ? error.message : String(error); this.notify() }
  async initialize() {
    try {
      this.projects = (await projectStorage.list()).sort((a, b) => b.updatedAt - a.updatedAt)
      if (this.disposed) return
      await this.load(this.projects[0] ?? newComposition(this.projects))
    } catch (error) { this.report(error); this.status = 'Local saving unavailable'; }
    if (this.disposed) return
    const changed = () => this.changed()
    this.unsubscribers.push(this.editor.controller.historyController.subscribe(changed))
    this.editor.controls.addEventListener('end', changed)
    this.unsubscribers.push(() => this.editor.controls.removeEventListener('end', changed))
    this.unsubscribers.push(this.editor.controller.subscribe(this.notify))
    this.unsubscribers.push(this.editor.reactBridge.subscribe(this.notify))
    window.addEventListener('pagehide', this.flushOnHide)
    window.addEventListener('beforeunload', this.beforeUnload)
    document.addEventListener('visibilitychange', this.visibilityChange)
    this.notify()
  }
  private flushOnHide = () => { void this.save().catch(this.report) }
  private visibilityChange = () => { if (document.hidden) this.flushOnHide() }
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.revision !== this.savedRevision) { event.preventDefault(); event.returnValue = ''; this.flushOnHide() }
  }
  changed = () => {
    if (this.changing || this.disposed) return
    this.revision++
    this.status = 'Saving…'
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.save().catch(this.report) }, 450)
    this.notify()
  }
  snapshot(): Composition {
    const assets = this.project.assets
    return { ...this.project, updatedAt: Date.now(), assets: [...assets], pieces: this.editor.controller.project.placedMeshList.getAll().map(p => ({
      id: p.id, assetId: p.assetId || p.texture.userData.assetId, kind: p.kind, shape: p.sourceShape,
      mesh: packMesh(p.mesh), flat: p.flatBackup ? packMesh(p.flatBackup) : undefined, opacity: p.opacity, contrast: p.contrast,
    })), camera: { position: this.editor.camera.position.toArray(), target: this.editor.controls.target.toArray() } }
  }
  save = async () => {
    clearTimeout(this.timer)
    if (this.changing || this.disposed) return
    const data = this.snapshot(), revision = this.revision
    const work = this.saveQueue.catch(() => {}).then(async () => {
      await projectStorage.put(data)
      this.savedRevision = revision
      this.projects = [data, ...this.projects.filter(p => p.id !== data.id)]
      this.status = revision === this.revision ? 'Saved on this device' : 'Saving…'
      this.notify()
    })
    this.saveQueue = work
    return work.catch(error => { this.status = 'Not saved - export a backup'; this.notify(); throw error })
  }
  async load(project: Composition) {
    if (this.editor.patchBaker.isBaking()) throw new Error('Wait for surface projection to finish before switching projects.')
    this.busy = true; this.changing = true; this.notify()
    const textures = new Map<string, Texture>()
    try {
      validateProject(project)
      for (const asset of project.assets) {
        const texture = new Texture(await decodeImage(asset.data))
        texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; texture.userData.assetId = asset.id
        textures.set(asset.id, texture)
      }
      if (this.disposed) { textures.forEach(t => t.dispose()); return }
      const c = this.editor.controller
      this.editor.patchBaker.cancelAll()
      c.setActiveTool(c.getSelectTool()); c.setSelectedPlacedMeshId(null)
      this.editor.patchBaker.cancelAll()
      for (const p of c.project.placedMeshList.getAll()) {
        c.clearWrapPreview(p.id); this.editor.previewScene.remove(p.mesh)
        p.mesh.geometry.dispose(); (Array.isArray(p.mesh.material) ? p.mesh.material : [p.mesh.material]).forEach(m => m.dispose())
        p.flatBackup?.geometry.dispose(); c.project.placedMeshList.removeById(p.id)
      }
      c.clearImageCache()
      this.textures.forEach(t => t.dispose()); this.textures = textures
      this.project = structuredClone(project)
      this.editor.previewMesh.setSkinTone(project.skinTone ?? 0)
      for (const p of project.pieces) {
        const texture = textures.get(p.assetId)!, asset = project.assets.find(a => a.id === p.assetId)!
        const mesh = RegionMeshFactory.createMesh(p.shape, texture, asset.width / asset.height)
        mesh.geometry.dispose(); const state = unpackMesh(p.mesh)
        mesh.geometry = state.geometry; mesh.position.copy(state.position); mesh.quaternion.copy(state.quaternion); mesh.scale.copy(state.scale)
        c.project.placedMeshList.add(p.id, mesh, p.shape, texture, asset.width / asset.height)
        const piece = c.project.placedMeshList.getById(p.id)!
        piece.assetId = p.assetId; piece.opacity = p.opacity; piece.contrast = p.contrast; piece.kind = p.kind
        piece.everWrapped = p.kind === 'drapedPatch'; piece.flatBackup = p.flat ? unpackMesh(p.flat) : undefined
        piece.bakeDirty = p.kind === 'drapedPatch'
        this.editor.previewScene.add(mesh)
      }
      this.editor.camera.position.fromArray(project.camera.position)
      this.editor.controls.target.fromArray(project.camera.target); this.editor.controls.update()
      c.historyController.clear(); c.refreshBakeAndVisibility()
      for (const p of c.project.placedMeshList.getAll()) this.editor.patchBaker.scheduleBake(p.id)
      this.revision = 0; this.savedRevision = 0; this.status = 'Saved on this device'; this.error = ''; this.placementAssetId = null
    } finally { this.busy = false; this.changing = false; this.notify() }
  }
  async switchProject(id: string) { await this.save(); const p = this.projects.find(p => p.id === id); if (p) await this.load(p) }
  async createProject() { await this.save(); await this.load(newComposition(this.projects)); this.changed(); await this.save() }
  async deleteProject(id: string) {
    await this.save()
    if (!this.projects.some(p => p.id === id)) return
    if (id === this.project.id) {
      const next = this.projects.find(p => p.id !== id) ?? newComposition(this.projects)
      await this.load(next)
    }
    await projectStorage.delete(id)
    this.projects = this.projects.filter(p => p.id !== id); await this.save(); this.notify()
  }
  setSkinTone(depth: number) {
    if (this.busy || !Number.isFinite(depth)) return
    this.project.skinTone = Math.max(0, Math.min(1, depth))
    this.editor.previewMesh.setSkinTone(this.project.skinTone)
    this.changed()
  }
  async importImages(files: File[]) {
    if (this.project.assets.length + files.length > 100) throw new Error('A project can contain up to 100 images.')
    const assets: ImageAsset[] = []
    for (const file of files) assets.push(await readPNG(file))
    this.project.assets.push(...assets); this.changed(); return assets
  }
  removeImage(id: string) {
    if (this.editor.controller.project.placedMeshList.getAll().some(p => (p.assetId || p.texture.userData.assetId) === id)) throw new Error('Remove this image’s tattoos from the composition first.')
    this.project.assets = this.project.assets.filter(a => a.id !== id)
    // Clear history: removed source images must not be resurrected without their originals.
    this.editor.controller.historyController.clear(); this.changed()
  }
  async place(asset: ImageAsset, point?: { x: number; y: number }) {
    if (this.editor.controller.project.placedMeshList.getAll().length >= 100) throw new Error('A composition can contain up to 100 tattoos.')
    this.editor.controller.tattoosVisible = true
    if (!await this.editor.controller.beginPolygonMeshPlacement(asset.data, fullImage)) return
    this.placementAssetId = asset.id
    // The source identity lives with the texture so click-to-place and drag/drop share one pipeline.
    this.editor.controller.setPendingAssetId(asset.id)
    if (point) {
      const rect = this.editor.renderer.domElement.getBoundingClientRect()
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2((point.x - rect.left) / rect.width * 2 - 1, -(point.y - rect.top) / rect.height * 2 + 1), this.editor.camera)
      const hit = ray.intersectObject(this.editor.previewMesh.mesh, false)[0]
      if (hit) this.editor.controller.placePendingMeshAt(hit)
      else { this.notify(); throw new Error('Drop on the arm, or click its surface to place the selected design.') }
    }
    this.notify()
  }
  cancelPlacement() { this.editor.controller.setActiveTool(this.editor.controller.getSelectTool()); this.placementAssetId = null; this.notify() }
  apply() {
    if (!this.editor.controller.wrapSelectedPlacedMesh()) throw new Error('This design cannot wrap here. Reduce its size or move it away from the edge, then apply again.')
    this.changed()
  }
  duplicate() {
    const c = this.editor.controller, p = c.getSelectedPlacedMesh()
    if (!p) return
    if (c.project.placedMeshList.getAll().length >= 100) throw new Error('A composition can contain up to 100 tattoos.')
    const mesh = p.mesh.clone(false); mesh.geometry = p.mesh.geometry.clone(); mesh.material = (p.mesh.material as import('three').Material).clone()
    const copy = new Piece({ id: crypto.randomUUID(), mesh, texture: p.texture, sourceShape: structuredClone(p.sourceShape), sketchAspect: p.sketchAspect, stackIndex: c.project.placedMeshList.getAll().length, contrast: p.contrast, kind: p.kind, wrapPreviewValid: null, everWrapped: p.everWrapped, flatBackup: p.flatBackup ? { ...p.flatBackup, geometry: p.flatBackup.geometry.clone(), position: p.flatBackup.position.clone(), quaternion: p.flatBackup.quaternion.clone(), scale: p.flatBackup.scale.clone() } : undefined })
    copy.opacity = p.opacity; copy.assetId = p.assetId || p.texture.userData.assetId
    c.historyController.execute({ execute: () => { c.project.placedMeshList.restore(copy); this.editor.previewScene.add(mesh); this.editor.patchBaker.scheduleBake(copy.id) }, undo: () => { this.editor.previewScene.remove(mesh); c.project.placedMeshList.removeById(copy.id) }, isUndoable: () => true })
    this.editor.reactBridge.setSelectedPlacedMeshId(copy.id)
  }
  reorder(id: string, direction: number) {
    const c = this.editor.controller, list = c.project.placedMeshList
    const from = list.getAll().findIndex(p => p.id === id), to = from + direction
    if (from < 0 || to < 0 || to >= list.getAll().length) return
    c.historyController.execute({ execute: () => list.moveEntry(from, to), undo: () => list.moveEntry(to, from), isUndoable: () => true })
  }
  opacity(value: number) {
    const c = this.editor.controller, p = c.getSelectedPlacedMesh(); if (!p) return
    const before = p.opacity
    c.historyController.execute({ execute: () => { p.opacity = value }, undo: () => { p.opacity = before }, isUndoable: () => true })
  }
  transform(scale?: number, rotation?: number) {
    const c = this.editor.controller, p = c.getSelectedPlacedMesh(); if (!p || p.kind !== 'regionMesh') return
    const before = snapshotMesh(p.mesh)
    const after = { position: p.mesh.position.clone(), quaternion: p.mesh.quaternion.clone(), scale: p.mesh.scale.clone() }
    if (scale !== undefined) after.scale.set(scale, scale, scale)
    if (rotation !== undefined) after.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotation))
    c.historyController.execute(new UpdatePlacedMeshCommand(p.id, before, after, c))
    before.geometry.dispose(); c.scheduleWrapPreview(p.id)
  }
  view(angle: string) {
    const positions: Record<string, number[]> = { front: [0, 0.3, 4.2], back: [0, 0.3, -4.2], left: [-4.2, 0.3, 0], right: [4.2, 0.3, 0], perspective: [1.4, 0.45, 3.35] }
    if (!positions[angle]) return
    this.editor.controls.target.set(0, 0, 0); this.editor.camera.position.fromArray(positions[angle]); this.editor.controls.update(); this.changed()
  }
  toggleTattoos() { const c = this.editor.controller; c.tattoosVisible = !c.tattoosVisible; c.refreshBakeAndVisibility(); for (const p of c.project.placedMeshList.getAll()) c.clearWrapPreview(p.id); this.editor.overlayScene.visible = c.tattoosVisible; this.notify() }
  exportProject() { download(new Blob([JSON.stringify(this.snapshot())], { type: 'application/json' }), `${this.filename()}.tattoo.json`) }
  async importProject(file: File) {
    if (file.size > 150 * 1024 * 1024) throw new Error('Project files must be smaller than 150 MB.')
    const project = validateProject(JSON.parse(await file.text()))
    project.id = crypto.randomUUID(); project.name = project.name || 'Imported sleeve'
    await this.save(); await this.load(project); this.changed(); await this.save()
  }
  private filename() { return (this.project.name || 'sleeve').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'sleeve' }
  async exportImage(width: number) {
    if (this.editor.controller.project.placedMeshList.getAll().some(p => p.kind !== 'drapedPatch')) throw new Error('Apply each positioned tattoo to skin before exporting the composition.')
    this.editor.reactBridge.setSelectedPlacedMeshId(null)
    for (const p of this.editor.controller.project.placedMeshList.getAll()) this.editor.patchBaker.scheduleBake(p.id)
    await this.editor.patchBaker.waitUntilIdle()
    const { renderer, composer, camera, overlayScene, previewScene } = this.editor
    const size = renderer.getSize(new Vector2()), ratio = renderer.getPixelRatio(), aspect = camera.aspect, overlays = overlayScene.visible, background = previewScene.background
    const height = Math.round(width / aspect)
    if (Math.max(width, height) > renderer.capabilities.maxTextureSize) throw new Error('This resolution exceeds your graphics device limit. Choose a smaller export.')
    try {
      this.busy = true; this.notify()
      overlayScene.visible = false
      // Export the artwork on the studio ground, without interface engraving.
      previewScene.background = background ?? new Color(getComputedStyle(renderer.domElement.closest('.viewport')!).backgroundColor)
      renderer.setPixelRatio(1); renderer.setSize(width, height, false); composer.setPixelRatio(1); composer.setSize(width, height)
      this.editor.render()
      const blob = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(b => b ? resolve(b) : reject(new Error('Image export failed. Try a smaller resolution.')), 'image/png'))
      download(blob, `${this.filename()}-${width}px.png`)
    } finally {
      renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false); composer.setPixelRatio(ratio); composer.setSize(size.x, size.y)
      camera.aspect = aspect; camera.updateProjectionMatrix(); overlayScene.visible = overlays; previewScene.background = background
      // The viewport can finish resizing while PNG encoding is asynchronous.
      this.editor.resize(true)
      this.busy = false; this.notify()
    }
  }
  destroy() {
    clearTimeout(this.timer); this.disposed = true
    this.unsubscribers.forEach(unsubscribe => unsubscribe())
    window.removeEventListener('pagehide', this.flushOnHide); window.removeEventListener('beforeunload', this.beforeUnload); document.removeEventListener('visibilitychange', this.visibilityChange)
    this.textures.forEach(t => t.dispose()); this.listeners.clear()
  }
}
