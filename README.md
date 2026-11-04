# fxlab landing · MR prototype

Parallel WebXR prototype of the fxlab landing (Figma frame "Landing · L1 · üç bölüm").
Built to test the design in a Meta Quest in mixed reality before adapting it into Barış's fxlab repo.
It does not change or depend on the fxlab code; it only reads snapshots of fxlab's public evidence API.

- Open the page in Quest Browser and choose **Enter MR**. A desktop browser shows a preview (drag to orbit).
- Sizes: 1 dp in Figma = 1 mm in the room. The landing appears 1.15 m in front of you.
- Interaction: touch buttons with your index finger, or pinch with the ray. Pinch an empty surface to grab and move the landing.
- Data: `data/5h.json`, `data/1d.json`, `data/1w.json` from `snapshot.ps1`. Without them the page uses `data/fixture.json` (an old held sample from Barış's repo tests).
- NEWS and SIMULATOR show the sample content from Figma; they have no data source yet.

Fonts: Manrope, Kode Mono (SIL OFL, via Fontsource). Icons: Phosphor (MIT). three.js r170 (MIT).
