import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Download, Eye, EyeOff, FolderOpen, ImagePlus, LoaderCircle, Maximize, MousePointer2, Plus, Redo2, RotateCcw, RotateCw, Trash2, Undo2, Upload, X } from 'lucide-react'
import { Container } from '@/lib/di/container'
import { EditorFactory } from '@/editor/main/EditorFactory'
import { registerEditorServices } from '@/editor/services/registerEditorServices'
import { registerPreviewMeshInstances } from '@/editor/main/registerPreviewMeshInstances'
import { PreviewMeshRegistrar } from '@/editor/main/PreviewMeshRegistrar'
import { StudioSession } from './StudioSession'
import { ImageAsset } from './storage'
import { EditorToolId } from '@/editor/main/tools/EditorTool'
import { StudioIdentity, LibraryEmpty } from './StudioIdentity'
import './studio.css'


export function Studio() {
  const mount = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<StudioSession | null>(null)
  useLayoutEffect(() => {
    if (session && !session.busy) session.editor.previewScene.background = null
  }, [session, session?.busy])
  const [error, setError] = useState('')
  const [, render] = useState(0)
  const [activePanel, setActivePanel] = useState<'designs' | 'layers'>('designs')
  const [activeView, setActiveView] = useState('')
  useEffect(() => { setActiveView('') }, [session?.project.id])
  const [resolution, setResolution] = useState(2048)
  const [dragging, setDragging] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const projectImport = useRef<HTMLInputElement>(null)
  const [deleteProject, setDeleteProject] = useState<{ id: string; name: string } | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (deleteProject) deleteDialog.current?.showModal() }, [deleteProject])

  useEffect(() => {
    let cancelled = false, active: StudioSession | undefined, unsubscribe: (() => void) | undefined
    const container = new Container()
    registerEditorServices(container)
    registerPreviewMeshInstances(container.resolve<PreviewMeshRegistrar>('PreviewMeshRegistrar'))
    new EditorFactory(container).createEditor(mount.current!).then(async editor => {
      if (cancelled) { editor.destroy(); return }
      active = new StudioSession(editor)
      unsubscribe = active.subscribe(() => render(n => n + 1))
      editor.controls.addEventListener('start', () => setActiveView(''))
      editor.animate()
      await active.initialize()
      if (!cancelled) setSession(active)
    }).catch(reason => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true; unsubscribe?.(); active?.destroy(); active?.editor.destroy() }
  }, [])

  const run = (action: () => unknown) => { try { Promise.resolve(action()).catch(e => session?.report(e)) } catch (e) { session?.report(e) } }
  const editor = session?.editor, controller = editor?.controller
  const selected = controller?.getSelectedPlacedMesh()
  const pieces = controller?.project.placedMeshList.getAll() ?? []
  const placing = controller?.getState().activeToolId === EditorToolId.Placement
  const history = controller?.historyController.getState()
  const assetFor = (id: string) => session?.project.assets.find(a => a.id === id)
  const selectedAsset = selected && assetFor(selected.assetId || selected.texture.userData.assetId)
  const blocked = !session || session.busy || !!editor?.patchBaker.isBaking()

  const importFiles = (files: FileList | null) => { if (files?.length) run(() => session?.importImages(Array.from(files))) }
  const dropOnArm = (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false)
    if (!session || blocked) return
    const point = { x: event.clientX, y: event.clientY }
    const id = event.dataTransfer.getData('application/x-tattoo-image')
    const asset = assetFor(id)
    if (asset) run(() => session.place(asset, point))
    else if (event.dataTransfer.files.length) {
      const files = Array.from(event.dataTransfer.files)
      run(async () => { const assets = await session.importImages(files); if (assets[0]) await session.place(assets[0], point) })
    }
  }

  return <main className="studio">
    <div className="workspace">
      <div className="sidebar-column">
      <div className="asset-dock">
        <StudioIdentity/>
        <nav className="dock-tabs" aria-label="Workspace panels"><button aria-pressed={activePanel === 'designs'} onClick={() => setActivePanel('designs')}>Artwork {(session?.project.assets.length ?? 0) > 0 && <span>{session?.project.assets.length}</span>}</button><button aria-pressed={activePanel === 'layers'} onClick={() => setActivePanel('layers')}>Layers {pieces.length > 0 && <span>{pieces.length}</span>}</button></nav>
      <aside className={`design-panel ${activePanel === 'designs' ? 'mobile-visible' : ''}`} aria-label="Design library" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); importFiles(e.dataTransfer.files) }}>
        
        <button className="upload-button" disabled={blocked} onClick={() => upload.current?.click()}><ImagePlus size={18}/>Import PNG</button>
        {!session?.project.assets.length ? <LibraryEmpty/> : <div className="image-library">{session.project.assets.map((asset) => <DesignTile key={asset.id} asset={asset} disabled={blocked} onPlace={() => run(() => session.place(asset))} onRemove={() => run(() => session.removeImage(asset.id))}/>)}</div>}
        
      </aside>
      <aside className={`composition-panel ${activePanel === 'layers' ? 'mobile-visible' : ''}`} aria-label="Composition layers">
        
        <div className="layer-list">{pieces.length === 0 ? <LibraryEmpty layers/> : [...pieces].reverse().map((piece, i) => {
          const asset = assetFor(piece.assetId || piece.texture.userData.assetId)
          return <div className={`layer-row ${selected?.id === piece.id ? 'selected' : ''}`} key={piece.id}><button className="layer-select" onClick={() => editor?.reactBridge.setSelectedPlacedMeshId(piece.id)}><img src={asset?.data} alt=""/><span><strong>{asset?.name ?? 'Tattoo design'}</strong><small>{piece.kind === 'drapedPatch' ? 'Applied to skin' : 'Positioning'}</small></span></button><div className="layer-order"><button aria-label={`Move ${asset?.name} up`} disabled={i === 0 || blocked} onClick={() => session?.reorder(piece.id, 1)}><ArrowUp size={13}/></button><button aria-label={`Move ${asset?.name} down`} disabled={i === pieces.length - 1 || blocked} onClick={() => session?.reorder(piece.id, -1)}><ArrowDown size={13}/></button></div></div>
        })}</div>
      </aside>
      </div>
        <div className="view-controls"><label className="skin-tone-control" title="Skin tone"><input type="range" min="0" max="1" step="0.01" aria-label="Skin tone" aria-valuetext={`${Math.round((session?.project.skinTone ?? 0) * 100)}% depth`} value={session?.project.skinTone ?? 0} disabled={blocked} onChange={event => session?.setSkinTone(Number(event.target.value))}/></label>
        <div className="view-presets" aria-label="Viewing angle">{['front', 'back', 'left', 'right'].map(v => <button key={v} disabled={blocked} aria-pressed={activeView === v} onClick={() => { session?.view(v); setActiveView(v) }}><span>{v}</span></button>)}</div></div>
      </div>
      <section className={`viewport ${dragging ? 'drop-active' : ''}`} aria-label="3D arm composition" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={dropOnArm}>
        <div className="canvas-mount" ref={mount}/>
        <div className="canvas-controls" onDragOver={e => e.stopPropagation()} onDrop={e => { e.preventDefault(); e.stopPropagation() }}>
<div className="inspection-tools"><button aria-label="Toggle tattoo visibility" title={controller?.tattoosVisible === false ? 'Show tattoos' : 'Hide tattoos'} disabled={blocked} aria-pressed={controller ? !controller.tattoosVisible : false} onClick={() => session?.toggleTattoos()}>{controller?.tattoosVisible === false ? <EyeOff size={16}/> : <Eye size={16}/>}</button><button title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={e => { const root = e.currentTarget.closest('main'); run(() => document.fullscreenElement ? document.exitFullscreen() : root?.requestFullscreen()) }}><Maximize size={16}/></button></div>
<div className="history-tools"><button title="Undo (Ctrl / ⌘ Z)" aria-label="Undo" disabled={blocked || !history?.canUndo} onClick={() => controller?.historyController.undo()}><Undo2 size={17}/></button><button title="Redo (Ctrl / ⌘ Shift Z)" aria-label="Redo" disabled={blocked || !history?.canRedo} onClick={() => controller?.historyController.redo()}><Redo2 size={17}/></button></div>
      <details className="export-menu"><summary className="primary" aria-label="Export"><Download size={16}/><span>Export</span></summary>
        <div className="menu-content"><h2>Export current view</h2>
          <label>Image width<select value={resolution} onChange={e => setResolution(Number(e.target.value))}><option value={1024}>1024 px</option><option value={2048}>2048 px</option><option value={4096}>4096 px</option></select></label>
          <button className="primary" disabled={blocked} onClick={() => run(() => session?.exportImage(resolution))}><Download size={16}/>Download PNG</button>
        </div>
      </details>
      <details className="project-menu"><summary aria-label="File"><FolderOpen size={16}/><span>File</span><ChevronDown size={13}/></summary>
        <div className="menu-content">
          <div className="project-list">{session?.projects.map(p => <div key={p.id} className={`project-row ${p.id === session.project.id ? 'active-project' : ''}`}>
            <button className="project-open" disabled={blocked} aria-current={p.id === session.project.id ? 'true' : undefined} onClick={e => { run(() => session.switchProject(p.id)); e.currentTarget.closest('details')?.removeAttribute('open') }}><span title={p.name}>{p.name || 'TattooStudioWorks'}</span><small>{new Date(p.updatedAt).toLocaleDateString()}</small></button>
            <button className="project-delete danger-text" disabled={blocked} aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`} onClick={() => setDeleteProject({ id: p.id, name: p.name })}><Trash2 size={15}/></button>
          </div>)}</div>
          <button disabled={blocked} onClick={() => run(() => session?.createProject())}><Plus size={16}/>New composition</button>
          <button disabled={blocked} onClick={() => projectImport.current?.click()}><Upload size={16}/>Import project file</button>
          <button disabled={blocked} onClick={() => session?.exportProject()}><Download size={16}/>Download project file</button>
          <p>Projects stay on this device. Download a file to keep a backup.</p>
        </div>
      </details>
        </div>
        {(placing || dragging) && <div className="placement-message"><MousePointer2 size={17}/><span>{dragging ? 'Drop on the arm to place' : 'Click the arm to place your design'}</span><button aria-label="Cancel placement" onClick={() => session?.cancelPlacement()}><X size={16}/></button></div>}
        {!session && <div className="loading-view">{error ? <><h2>Could not open the studio</h2><p>{error}</p><button onClick={() => location.reload()}>Try again</button></> : <><LoaderCircle className="spinner" size={25}/><h2>Preparing your canvas</h2><p>Loading the arm and skin textures…</p></>}</div>}
        {(session?.busy || editor?.patchBaker.isBaking()) && <div className="working-state" role="status"><LoaderCircle size={16} className="spinner"/>Preparing surface…</div>}

      {selected && <aside className="context-panel"><section className="inspector" aria-label="Selected tattoo controls"><div className="panel-heading"><h2>Selected tattoo</h2>{selected && <button aria-label="Deselect tattoo" onClick={() => editor?.reactBridge.setSelectedPlacedMeshId(null)}><X size={15}/></button>}</div>
          {selected ? <><p className="selected-name">{selectedAsset?.name ?? 'Tattoo design'}</p>
            {selected.kind === 'drapedPatch' ? <><div className="applied-status"><Check size={15}/>Applied to skin</div><button className="wide" disabled={blocked} onClick={() => controller?.unwrapSelectedPlacedMesh()}><MousePointer2 size={15}/>Edit position & size</button></> : <><p className="control-help">Drag to position. Use the handles to resize and rotate.</p><label className="range-field"><span>Size <output>{Math.round(selected.mesh.scale.x * 100)}%</output></span><input aria-label="Tattoo size" type="range" min="0.1" max="5" step="0.05" value={selected.mesh.scale.x} onChange={e => session?.transform(Number(e.target.value))}/></label><div className="rotation-controls"><span>Rotate</span><button aria-label="Rotate counterclockwise 15 degrees" onClick={() => session?.transform(undefined, Math.PI / 12)}><RotateCcw size={15}/>15°</button><button aria-label="Rotate clockwise 15 degrees" onClick={() => session?.transform(undefined, -Math.PI / 12)}><RotateCw size={15}/>15°</button></div><button className="primary wide" disabled={blocked} onClick={() => run(() => session?.apply())}><Check size={16}/>Apply to skin</button></>}
            <label className="range-field"><span>Opacity <output>{Math.round(selected.opacity * 100)}%</output></span><input aria-label="Tattoo opacity" type="range" min="0" max="1" step="0.01" value={selected.opacity} onChange={e => session?.opacity(Number(e.target.value))}/></label>
            <div className="piece-actions"><button disabled={blocked} onClick={() => run(() => session?.duplicate())}><Copy size={15}/>Duplicate</button><button disabled={blocked} className="danger-text" onClick={() => editor?.reactBridge.handleDelete()}><Trash2 size={15}/>Remove</button></div>
          </> : <div className="inspector-empty"><p>Select a tattoo to adjust its placement, size and opacity.</p><ol><li>Add your PNG designs</li><li>Place and arrange on the arm</li><li>Apply to skin, then export</li></ol></div>}
        </section>
      </aside>}
      </section>
    </div>
    {session?.error && <div className="error-toast" role="alert"><p>{session.error}</p><button aria-label="Dismiss message" onClick={() => { session.error = ''; session.notify() }}><X size={18}/></button></div>}
    {deleteProject && <dialog role="alertdialog" aria-modal="true" onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }} ref={deleteDialog} onCancel={() => setDeleteProject(null)} onClose={() => setDeleteProject(null)} aria-labelledby="delete-title" className="dialog-backdrop"><section className="confirm-dialog"><h2 id="delete-title">Delete this composition?</h2><p>“{deleteProject.name}” will be removed from this device. Download a project file first if you want a backup.</p><div><button autoFocus onClick={() => deleteDialog.current?.close()}>Keep project</button><button className="danger" onClick={() => { deleteDialog.current?.close(); run(() => session?.deleteProject(deleteProject.id)) }}>Delete project</button></div></section></dialog>}
    <input type="file" accept="image/png,.png" multiple hidden ref={upload} onChange={e => { importFiles(e.target.files); e.target.value = '' }}/>
    <input type="file" accept=".json,.tattoo.json" hidden ref={projectImport} onChange={e => { const file = e.target.files?.[0]; if (file) run(() => session?.importProject(file)); e.target.value = '' }}/>
  </main>
}

function DesignTile({ asset, disabled, onPlace, onRemove }: { asset: ImageAsset; disabled: boolean; onPlace: () => void; onRemove: () => void }) {
  return <div className="design-tile"><button disabled={disabled} draggable={!disabled} onDragStart={e => { e.dataTransfer.setData('application/x-tattoo-image', asset.id); e.dataTransfer.effectAllowed = 'copy' }} onClick={onPlace} className="design-preview" title={`Place ${asset.name}`}><img src={asset.data} alt={asset.name} draggable={false}/></button><div><span title={asset.name}>{asset.name}</span><button aria-label={`Remove ${asset.name} from library`} onClick={onRemove} disabled={disabled}><X size={13}/></button></div></div>
}
