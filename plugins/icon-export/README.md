# Chopstick Icon Export Plugin

A custom Figma plugin for the Chopstick design system. It scans an icon library built with Figma's component/variant system and exports selected icons, across selected brand variants, as cleaned, organized SVG files packaged into a single ZIP.

For a deeper technical walkthrough of every file and design decision, see [`ARCHITECTURE_REFERENCE.md`](./ARCHITECTURE_REFERENCE.md).


## Why a Custom Plugin

Figma has no native way to batch-export a structured icon library as cleaned, brand-organized SVG files. This plugin scans the page (or the current selection) for icon component sets, lets the user pick exactly which icons and which brand variants to include, strips Figma-internal cruft from the exported SVG markup, and packages the result as a ready-to-use ZIP.


## Running the Plugin

### Technical Stack

- **Vite 7** -- Build tooling (manual two-build setup, no Plugma abstraction)
- **TypeScript** -- Language
- **@figma/plugin-typings** -- Figma Plugin API types
- **vite-plugin-singlefile** -- Inlines UI assets into a single HTML file for Figma's iframe constraint
- **JSZip 3.10.x** -- ZIP file generation in the browser

No SVG optimization library, no sprite-generation library, and no additional tooling beyond the above. The dependency list is intentionally minimal.

### Development

```bash
cd plugins/icon-export
npm install
npm run dev
```

This starts two Vite watchers in parallel: one for the main sandbox code and one for the UI.

### Production Build

```bash
npm run build
```

### Installing in Figma

1. Open Figma Desktop
2. Go to Plugins > Development > Import plugin from manifest
3. Select `plugins/icon-export/manifest.json`
4. Open your Chopstick Figma file
5. Run the plugin from Plugins > Development > Chopstick Icon Export

> **Note on `manifest.json`'s `id` field**: it's currently set to a placeholder (`"REPLACE_ON_IMPORT"`). Figma typically assigns a real plugin ID automatically the first time you import or publish a dev plugin locally — if Figma Desktop rejects the placeholder on import, replace it with any string; Figma will overwrite it with a real ID on first publish.

### Export Output

The plugin generates a dated ZIP file named `chopstick-icons-YYYYMMDD.zip` in your downloads folder, containing one folder per brand with that brand's selected SVGs inside.


## Icon Organization in Figma

Icons are discovered structurally, with no description tags or naming suffixes involved:

- A `COMPONENT_SET` named `icon/<icon-name>` is the unit of one icon (e.g. `icon/add_circle`). The `icon/` prefix is the only signal the plugin uses to recognize something as an icon.
- Each `COMPONENT` child of that set is treated as one brand variant of the icon.
- Brand is read from each variant's own Figma variant name, which follows Figma's standard `property=value` format (e.g. `don't use (brand)=Base`). Only the text after the **last** `=` is used as the brand value — the property name itself is never read or validated. Brand names are never hardcoded in the plugin; whatever values exist in the file are what shows up in the UI.
- No other variant axis (size, weight, fill style) is read or supported. If a component set has more than one variant property, only the brand-style property is used for grouping.


## Output Structure

```
chopstick-icons-YYYYMMDD.zip
├── base/
│   ├── add.svg
│   ├── addCircle.svg
│   └── arrowDown.svg
├── kiwi/
│   ├── add.svg
│   └── addCircle.svg
└── karumi/
    ├── add.svg
    └── addCircle.svg
```

Icon names convert from Figma's `snake_case` to `camelCase` for the output filename (`add_circle` → `addCircle.svg`). Brand folder names are the lowercased brand value. No sprite sheet, icon font, framework component wrappers, or manifest/index file are produced — just flat SVGs, one folder per brand.


## SVG Cleanup

Each exported SVG goes through a fixed sequence of cleanup passes before being written to the ZIP:

1. Remove the XML declaration
2. Remove HTML/XML comments
3. Remove empty `<g></g>` groups
4. Remove all `id="..."` attributes (Figma-internal, not meaningful downstream)
5. Remove all `data-*` attributes
6. Remove empty `<defs></defs>` blocks
7. Remove the `xmlns:xlink` namespace declaration, but only if no `xlink:` reference remains anywhere in the SVG
8. Collapse 3+ consecutive blank lines to one, then trim

**What it does not do**: it does not touch `width`/`height` attributes, does not normalize or rewrite `viewBox`, does not inject `currentColor` or otherwise alter fill/stroke values, and does not run any dedicated SVG optimizer. Icon dimensions and colors ship exactly as authored in the Figma component.


## Repository Structure

```
icon-export/
├── src/
│   ├── main.ts     Figma plugin entry point (sandbox): discovery, thumbnails, cleanup, export
│   ├── ui.ts       Plugin UI logic
│   ├── ui.html     Plugin UI markup
│   └── ui.css      Plugin UI styles
├── ARCHITECTURE_REFERENCE.md  Full technical reference: every file, every design decision
├── dist/           Built output (gitignored)
├── manifest.json   Figma plugin manifest
├── vite.config.ts  Vite build configuration
├── tsconfig.json   TypeScript configuration
└── package.json    Dependencies and scripts
```
