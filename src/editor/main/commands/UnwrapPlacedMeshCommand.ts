import type { EditorCommand } from '@/editor/main/EditorCommand'
import type { EditorController } from '@/editor/main/EditorController'
import { applyMeshSnapshot, snapshotMesh, MeshSnapshot } from '@/editor/main/MeshSnapshot'

/**
 * Restores a wrapped mesh to its backed-up flat state. Undo re-runs the wrap
 * algorithm rather than storing a separate wrapped-geometry snapshot - the
 * flat backup + target mesh fully determine the wrap result, so re-wrapping
 * from the restored flat state is deterministic.
 */
export class UnwrapPlacedMeshCommand implements EditorCommand {
	private applied: boolean = false
	private wrapped?: MeshSnapshot
	private flat?: MeshSnapshot

	public constructor(
		private readonly placedMeshId: string,
		private readonly controller: EditorController
	) {}

	public execute(): void {
		const entry = this.controller.project.placedMeshList.getById(this.placedMeshId)
		if (!entry || entry.kind !== 'drapedPatch') {
			this.applied = false
			return
		}
		this.wrapped = snapshotMesh(entry.mesh)
		this.flat = entry.flatBackup
		applyMeshSnapshot(entry.mesh, entry.flatBackup!)
		this.controller.project.placedMeshList.makeUnwrapped(this.placedMeshId, entry.mesh)
		this.applied = true
		this.controller.scheduleWrapPreview(this.placedMeshId)
	}

	public undo(): void {
		if (!this.applied) {
			return
		}
		const entry = this.controller.project.placedMeshList.getById(this.placedMeshId)
		if (!entry) {
			return
		}
        if (this.wrapped && this.flat) {
            applyMeshSnapshot(entry.mesh, this.wrapped)
            this.controller.project.placedMeshList.makeWrapped(this.placedMeshId, entry.mesh)
            entry.flatBackup = this.flat
            this.controller.clearWrapPreview(this.placedMeshId)
        }
	}

	public redo(): void {
		this.execute()
	}

	public isUndoable(): boolean {
		return true
	}
}
