import { PlacedMeshList } from '@/editor/main/PlacedMeshList'

/** Live mesh collection. StudioSession persists original images, geometry and transforms. */
export class Project {
	public readonly placedMeshList: PlacedMeshList = new PlacedMeshList()
}
