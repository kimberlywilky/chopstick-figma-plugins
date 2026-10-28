# Chopstick Icon Export Plugin — Architecture & Design Reference

> **Purpose of this document**: a complete technical reference for the Chopstick Icon Export Figma plugin, written so an AI agent or engineer can understand, maintain, or extend it without re-reading every source file. It covers what the plugin does and why it's built the way it is.

---

## 1. Plugin Identity & Purpose

**Problem it solves:** Figma has no native way to batch-export a structured icon library as cleaned, brand-organized SVG files. This plugin scans an icon library built with Figma's component/variant system and exports selected icons, across selected brand variants, as flat SVG files packaged into a single ZIP.

**Plugin identity** (`manifest.json`):
- Name: `Chopstick Icon Export`
- Entry points: `dist/main.js` (sandbox), `dist/ui.html` (UI)
- `editorType`: `["figma"]`
- `networkAccess.allowedDomains`: `["none"]` — the plugin makes no network calls of any kind; all processing happens locally inside the Figma sandbox and the plugin's UI iframe.
- `documentAccess`: `"dynamic-page"`

---

## 2. Monorepo Context

The plugin lives inside `chopstick-figma-plugins/`, alongside `token-export`, and shares the same `packages/shared/` utilities — nothing icon-specific is duplicated locally:

- `setStatus(type, message)` / `clearStatus()` — drives the `#status` element's styling and text for loading/success/error states.
- `downloadZip(files, filePrefix, JSZipConstructor)` plus `getDateTimestamp()` — builds a ZIP from an array of `{ path, content }` entries and triggers a browser download, named `<prefix>-<YYYYMMDD>.zip`.
- The two shared stylesheets (`base.css`, `components.css`) for reset/typography and common UI components (toggle buttons, checkbox lists, search bar, export button, status banner).

JSZip itself is a plugin-level dependency, not part of the shared package, since the shared code has no `node_modules` of its own for a bundler to resolve from — each plugin imports JSZip directly and passes the constructor into the shared `downloadZip` helper.

---

## 3. Technical Stack

- **Vite 7** — build tool, two-build setup driven by `--mode`, same pattern as token-export.
- **TypeScript**, strict mode, typed against `@figma/plugin-typings`.
- **`vite-plugin-singlefile`** — inlines all UI assets into one HTML file, required because Figma's plugin iframe needs a single self-contained file.
- **JSZip 3.10.x** — in-browser ZIP generation.
- **No icon-specific dependencies.** No SVG optimization library, no sprite-generation library. The dependency list is intentionally minimal — SVGs ship exactly as Figma exports them, aside from the cleanup pass described in §6.

### 3.1 Build Configuration

**`package.json` scripts**:
```json
"build": "vite build && vite build --mode ui && mv dist/src/ui.html dist/ui.html && rm -rf dist/src",
"dev": "vite build --watch & vite build --mode ui --watch"
```
Two separate Vite builds run per `npm run build`:
1. Default mode → builds `src/main.ts` as an IIFE library bundle → `dist/main.js` (the Figma sandbox code)
2. `--mode ui` → builds `src/ui.html` (and its inlined JS/CSS via `vite-plugin-singlefile`) → `dist/ui.js`, then the script moves the emitted `dist/src/ui.html` up to `dist/ui.html` and deletes the now-empty `dist/src/` folder.

**`vite.config.ts`** branches on `mode`, identical structure to token-export's: UI mode uses `viteSingleFile()` with `emptyOutDir: false`; default mode is a library build targeting `dist/main.js` with `emptyOutDir: true`.

**`tsconfig.json`**: target `ES2020`, strict mode, `moduleResolution: "bundler"`, `rootDir: ./src`, `outDir: ./dist`, Figma plugin typings in `typeRoots`.

---

## 4. What It Reads From Figma

**Target node type:** `COMPONENT_SET` nodes only. The plugin walks the node tree (the current page, or the current selection) recursively, and for every node checks `node.type === 'COMPONENT_SET'` whose `name` starts with `icon/`. Each direct `COMPONENT` child of a matching set is treated as one brand variant of that icon. Nodes that aren't component sets, or component sets not named with the `icon/` prefix, are skipped (traversal continues into their children if they have any, so icon sets can be nested inside frames or groups).

**Export call:**
```ts
await node.exportAsync({ format: 'SVG' })
```
No additional export settings are passed — no `svgOutlineText`, no `svgSimplifyStroke`, no `useAbsoluteBounds`, no custom scale/constraint. SVG export uses Figma's defaults end to end.

A second, separate export call is used only for in-plugin preview thumbnails, not the final output:
```ts
await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 4 } })
```
This PNG-at-4x export exists purely to render a small preview image next to each brand checkbox in the UI. It has no bearing on the SVG output.

**Variants as part of one icon:** Each `COMPONENT_SET` is one logical icon. Its `COMPONENT` children (the brand variants) are separate exportable outputs of that same icon, not merged into one file. There is no handling of additional variant axes (size, weight, style) — only one variant property is read: the one that encodes brand.

---

## 5. Naming & Organization Convention

**Icon grouping in Figma:** A `COMPONENT_SET` named `icon/<icon-name>` is the unit of one icon (e.g. `icon/add_circle`). The `icon/` prefix is the only signal the plugin uses to recognize something as an icon; everything after the prefix becomes the icon's internal name.

**Brand convention:** Brand is read from each variant's own name, which follows Figma's standard `property=value` variant-naming format (e.g. `don't use (brand)=Base`). The plugin extracts whatever comes after the **last** `=` in that string as the brand value. This means:
- Brand names are never hardcoded anywhere in the plugin logic.
- Whatever brand values exist as variant property values in the Figma file are what show up in the plugin UI, automatically.
- The property name itself (the part before `=`) is never read or validated; only the value after `=` matters.

**Variant axes other than brand:** None are read or supported. If a component set has more than one variant property, only the brand-style property is used for grouping.

**Output naming:** Icon names convert from Figma's `snake_case` to `camelCase` for the exported filename (`add_circle` becomes `addCircle.svg`). Brand folder names are the lowercased brand value (`Base` becomes `base/`, and so on for whatever other brand values exist in the file).

---

## 6. SVG Post-Processing

The cleanup step is a fixed sequence of string/regex operations applied to the raw SVG text returned by `exportAsync()`. In order:

1. Remove the XML declaration (`<?xml ... ?>`).
2. Remove HTML/XML comments.
3. Remove empty `<g></g>` groups.
4. Remove all `id="..."` attributes (Figma-internal identifiers, not meaningful downstream).
5. Remove all `data-*` attributes.
6. Remove empty `<defs></defs>` blocks.
7. Remove the `xmlns:xlink` namespace declaration, but only if no `xlink:` reference remains anywhere in the SVG.
8. Collapse three or more consecutive blank lines down to a single blank line, then trim leading/trailing whitespace.

**What it does not do:** it does not touch `width`/`height` attributes, does not normalize or rewrite `viewBox`, does not inject `currentColor` or otherwise alter fill/stroke values, and does not run any dedicated SVG optimizer. Icon dimensions and colors are exported and shipped exactly as authored in the Figma component, byte-for-byte aside from the specific cleanup steps listed above.

**Order matters.** Step 7's `xlink:` check happens *after* ids and data attributes have already been stripped (steps 4–6), not before. Any future change to the cleanup pipeline should preserve that sequence, or verify explicitly that reordering doesn't change results — the implementation is a fixed sequence of regex passes rather than a full XML/DOM parse.

---

## 7. Exclusion & Tagging Conventions

The only filter governing what the plugin discovers as an icon is structural: the node must be a `COMPONENT_SET`, and its name must start with `icon/`. There is no description-based tag (no equivalent to token-export's `[export-plugin-ignore]`), no naming-suffix convention, and no other mechanism for marking a node as excluded from discovery.

Selection of what actually gets exported in a given run happens entirely in the plugin UI, through per-icon and per-brand checkboxes. Every discovered icon and every brand variant appears as a selectable option by default; nothing is automatically hidden or pre-excluded.

---

## 8. Output Structure

The output is a single ZIP file containing flat SVG files organized into one folder per brand:

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

No sprite sheet, no icon font, no framework component wrappers, and no manifest/index file are produced. Each brand folder contains exactly the SVGs the user selected for that brand in the export run.

---

## 9. File-by-File Source Breakdown

### 9.1 `main.ts` (runs in the Figma sandbox)

- **`parseBrandFromVariantName(name)`** — splits a variant name on `=` and returns the trailing segment, trimmed. Falls back to the full trimmed name if there is no `=` at all.
- **`toCamelCase(name)`** — converts `snake_case` to `camelCase` via regex replace on `_` followed by a lowercase letter.
- **`findIconComponents(nodes)`** — recursive tree walk. Matches `COMPONENT_SET` nodes named `icon/...`, collects their `COMPONENT` children as brand variants (capturing `nodeId` and parsed `brand`), and otherwise recurses into any node that has children. Results are sorted alphabetically by icon name before being returned.
- **`buildScanResult(icons)`** — reduces the full icon/variant list down to the shape the UI needs: a list of `{ name, brands[] }` plus a deduplicated, sorted list of every brand seen across all icons.
- **`generateThumbnails(icons)`** — iterates every icon/variant pair, resolves the node by ID, exports it as a 4x-scale PNG, and posts it to the UI as a `thumbnail` message. Wrapped in a try/catch per-variant so one failed render doesn't stop the rest.
- **`cleanSvg(raw)`** — the regex cleanup pipeline described in §6.
- **`exportIconVariant(nodeId)`** — resolves a node by ID, calls `exportAsync({ format: 'SVG' })`, converts the returned byte array to a string, and runs it through `cleanSvg`.
- **`scanPage()` / `scanSelection()`** — entry points for the two scan modes. Both call `findIconComponents`, store the result in a module-level `currentIcons` variable (needed later by export, since the UI only round-trips icon names and brand strings, not node IDs), post the scan result to the UI, then kick off thumbnail generation.
- **`handleExport(selections)`** — given the UI's final list of `{ name, brands[] }` selections, looks up each icon/variant in `currentIcons` by name and brand match, exports and cleans each one, builds the `{ path, content }` list (`<brand>/<camelCase-name>.svg`), and posts progress messages after each individual export plus a final `export-complete` message with the full file list.
- **Message handler** (`figma.ui.onmessage`) — routes `scan-page`, `scan-selection`, and `start-export` messages from the UI to the functions above, catching and reporting errors back to the UI on failure.
- An initial `scanPage()` call runs immediately on plugin load, so the icon list populates without the user needing to click anything.

### 9.2 `ui.ts` (runs in the plugin's iframe)

- Holds all UI state: the full icon list, the full brand list, a per-icon `Set` of currently-selected brands (`iconBrandSelections`), which rows are expanded, a thumbnail URL cache, current search text, and which source tab (page or selection) is active.
- **`getTotalExportCount()` / `updateExportButton()`** — keeps the export button's enabled state and label text (`Export N icons`) in sync with the current selection count.
- **`getFilteredIcons()`** — applies the current search string as a case-insensitive substring match against icon names.
- **Brand dropdown** (`renderBrandDropdown`, `updateBrandDropdownCount`) — a multi-select dropdown of all brands, with "select all" / "deselect all" shortcuts. Toggling a brand here cascades into every icon's individual brand selection set.
- **`isBrandFullyActive(brand)`** — a brand counts as "fully selected" only if every icon that has that brand also has it checked. This keeps the dropdown's checkbox state consistent with whatever granular changes happen at the per-icon level.
- **`renderIconList()`** — renders the full icon list as expandable rows. Each row has a top-level checkbox (checked/indeterminate/unchecked based on how many of its brand variants are selected) and, when expanded, one checkbox per brand variant with a thumbnail image (or a placeholder until the thumbnail arrives from the sandbox).
- **`applyThumbnail(name, brand, data)`** — converts the PNG byte array received from the sandbox into a `Blob`/object URL, caches it, and swaps any matching placeholder element in the DOM for an actual `<img>`.
- Select all / deselect all toolbar buttons operate only on the currently filtered (searched) icon list, not the full set.
- Source tabs (Page / Selection) reset all state and request a fresh scan from the sandbox when switched.
- **`resetState()`** — revokes all cached thumbnail object URLs and clears every piece of UI state, called on source-tab switch to avoid stale data or memory leaks from abandoned object URLs.
- Export button click handler — builds the final `{ name, brands[] }` selection payload from `iconBrandSelections` (skipping any icon with zero selected brands) and posts a `start-export` message to the sandbox.
- **`window.onmessage` handler** — receives `scan-result`, `scan-error`, `thumbnail`, `export-progress`, `export-complete`, and `export-error` messages from the sandbox and updates the UI accordingly. On `export-complete`, it calls the shared `downloadZip()` helper with the returned file list.

### 9.3 `ui.html`

Static shell: title, description text, the Page/Selection source tabs, loading and empty-state containers, the toolbar (select all / deselect all plus the brand dropdown), the search input, the icon list container, the export button, and the status element. Loads `ui.css` and `ui.ts` (as a module script).

### 9.4 `ui.css`

Imports the two shared stylesheets first, then adds everything specific to this plugin's UI: source tabs, the icon panel layout, the brand dropdown, the expandable icon row styling (including the indeterminate-checkbox summary count and the rotating expand arrow), and the brand-level checkbox row with its thumbnail/placeholder styling.

---

## 10. End-to-End Data Flow

1. Plugin loads, UI opens at 400×480px, and `scanPage()` runs automatically against the current page.
2. The sandbox walks the node tree, finds every `COMPONENT_SET` named `icon/...`, and extracts each one's brand variants by parsing their variant names.
3. The sandbox sends the UI a flattened `{ name, brands[] }` list plus the full set of distinct brands found, and the UI renders the icon list with every icon and brand pre-selected.
4. The sandbox then exports a 4x PNG thumbnail for every single icon/brand combination and streams each one to the UI individually as it finishes, so thumbnails populate progressively rather than all at once.
5. The user adjusts selection (search, expand/collapse rows, toggle individual brand checkboxes, use the brand dropdown or select/deselect-all), or switches to Selection mode to scan only the current canvas selection instead of the whole page.
6. On clicking Export, the UI sends the sandbox the final list of selected icon/brand pairs.
7. The sandbox re-resolves each selected variant's node by ID, calls `exportAsync({ format: 'SVG' })`, runs the result through the cleanup pipeline, and streams progress messages back as each file finishes.
8. Once every selected variant has been exported, the sandbox sends the full `{ path, content }` file list to the UI in one `export-complete` message.
9. The UI passes that file list into the shared `downloadZip()` helper, which builds the ZIP in-browser with JSZip and triggers a direct file download.

---

## 11. Downstream Consumption

How the exported ZIP gets used after download — copied into a repo, run through a build step, imported as components, referenced via a sprite — lives outside this plugin's own scope and is addressed separately as part of the consuming project's own system design.

---

## 12. Known Quirks & Edge Cases

- **Brand parsing has a silent fallback.** If a variant name has no `=` in it at all, `parseBrandFromVariantName` returns the whole trimmed name as the "brand." This is not an error state — it will silently produce a brand group named after whatever the full variant name happens to be. Worth being deliberate about enforcing the `property=value` naming convention on every variant.
- **Only the last `=` segment is used.** If a variant name contains multiple `=` characters, only the text after the final one is treated as the brand value. This matters if any variant property values themselves happen to contain `=`.
- **No merge across duplicate icon names.** If two separate `COMPONENT_SET` nodes both happened to be named `icon/add` in different parts of the file, they'd be discovered as two independent entries (not merged), and the sort by name would place them adjacent to each other but the UI would still show two separate rows.
- **Thumbnails are best-effort.** A failed PNG export for a given variant (any reason) is silently swallowed; that variant simply never gets a thumbnail and the UI keeps showing its placeholder indefinitely. This does not block or fail the variant's actual SVG export later.
- **`currentIcons` is sandbox-side state, not passed back and forth.** The UI only ever knows icon names and brand strings, never node IDs. This means switching source tabs (Page/Selection) always requires a fresh scan round-trip; the plugin has no way to reuse a previous scan's node references across tab switches.
- **Selection mode with an empty selection returns an explicit empty result** rather than erroring, so the UI's empty-state messaging can differentiate "nothing selected" from "selection has no icons."
- **The SVG cleanup is order-dependent but not aggressive.** Because it operates as a fixed sequence of regex passes rather than parsing the SVG as a DOM/XML tree, any future change to the cleanup pipeline should preserve that sequence or verify re-ordering doesn't change results (for example, the `xmlns:xlink` removal depends on checking for `xlink:` usage after comments/ids have already been stripped, not before).
