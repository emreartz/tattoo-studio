
/** Presentation only; editor actions and project state live in Studio. */
export function StudioIdentity() {
  return <div className="studio-identity">
    <div className="brand-identity"><h1>Tattoo Studio</h1></div>
  </div>
}

export function LibraryEmpty({ layers = false }: { layers?: boolean }) {
  if (layers) return <div className="layers-empty"><p>No tattoos placed.</p><span>Drag artwork onto the arm.</span></div>
  return <div className="library-empty"><p>Import or drop transparent PNGs.</p><span>Up to 25 MB each</span></div>
}
