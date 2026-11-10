# Splat Studio

Vite + React + TS implementation of the Splat Studio design (`../project/Splat Studio.dc.html`).

    npm install && npm run dev

What is real (all client-side, nothing is uploaded):
- **Import**: your own videos, photos or folders (browser-decodable codecs; HEVC depends on the browser). Real duration/resolution/fps probing.
- **Frames**: time-based sampling at the preset fps/max/resolution, real Laplacian-variance blur scoring and dHash near-duplicate detection. Threshold edits re-classify instantly; click a frame to override.
- **Configure**: per-capture-type (Object / Room / Environment) editable presets.
- **Train & view**: exports a training bundle (`images/`, `splat_studio.json`, `train.sh` for nerfstudio splatfacto). Training itself needs COLMAP + CUDA, so it runs outside the browser; open the resulting `.ply`/`.splat` in the built-in WebGL viewer and convert between the two formats.

VRAM / train-time figures are rough planning estimates, not measurements.
