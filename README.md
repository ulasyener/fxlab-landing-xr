# fxlab landing · MR prototype

Parallel WebXR prototype of the fxlab landing (Figma frame "Landing · L1 · üç bölüm").
Built to test the design in a Meta Quest in mixed reality before adapting it into Barış's fxlab repo.
It does not change or depend on the fxlab code; it only reads snapshots of fxlab's public evidence API.

- Open the page in Quest Browser and choose **Enter MR**. A desktop browser shows a preview (drag to orbit).
- Sizes: 1 dp in Figma = 1 mm in the room. The landing appears 1.15 m in front of you.
- Interaction: touch buttons with your index finger, or pinch with the ray. Pinch an empty surface to grab and move the landing.
- Data: `data/5h.json`, `data/1d.json`, `data/1w.json` from `snapshot.ps1`. Without them the page uses `data/fixture.json` (an old held sample from Barış's repo tests).
- NEWS and SIMULATOR show the sample content from Figma; they have no data source yet.
- Room orbit (planet button on the bottom bar): the coins circle you like a solar system, no water. Orbit speed follows strength (stronger = faster); grab a coin and let it go nearer or farther to set its orbit. The button above it pauses / plays the orbits. Settings sit in `ROOM` in `app.js`.
- Diorama currencies are 3D coins (`assets/coins/<CODE>.glb`, Substance export packed with KTX2 + meshopt). Size, spin speed and reflection strength sit in `COIN` in `app.js`.
- Coin material: one shared aged-bronze texture set (`assets/coins/bronze_baseColor.webp`, `bronze_orm.webp`) on every coin; each GLB keeps its own relief normal map. Per-currency tone in `COIN_TONE` (multiplies the base colour).

Fonts: Manrope, Kode Mono (SIL OFL, via Fontsource). Icons: Phosphor (MIT). three.js r170 (MIT), incl. GLTFLoader, KTX2Loader + Basis transcoder, meshopt decoder, RoomEnvironment, XRHandModelFactory. Hand meshes: WebXR Input Profiles generic-hand (MIT).
- Manifold line language (build 41): white hairline contours with evenly spaced beads over a very faint dark base; currency trails as hairlines with beads (old end faint, new end bright); one hairline arch per coin pair, the strength gap shown only by the pulse (faster, brighter); needle pins (stem, ring, triangle up on a peak, down on a pit); fxlab pink only for the selected currency. Settings: `MANI`, `MANI_TRAIL`, `MLINK` in `app.js`.
