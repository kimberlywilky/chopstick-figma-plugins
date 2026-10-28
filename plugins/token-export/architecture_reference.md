# Chopstick Token Export Plugin — Architecture & Design Reference

> **Purpose of this document**: a complete technical reference for the Chopstick Token Export Figma plugin, written so an AI agent or engineer can understand, maintain, or extend it without re-reading every source file. It covers what the plugin does and why it's built the way it is.

---

## 1. What This Plugin Is

A custom Figma plugin for the Chopstick design system. It reads Figma variables (and select style types) from a Figma file, transforms them into **W3C DTCG-compliant JSON**, and packages the result as a dated ZIP file for consumption by **Style Dictionary v4**.

Every available token export tool outputs tokens in its own schema, but Style Dictionary v4 expects DTCG-compliant JSON. Rather than maintaining a middleware transformation layer on top of a third-party tool, the plugin outputs tokens directly in the exact format Style Dictionary expects, with no translation step needed downstream. This gives the team full ownership of the transformation pipeline — from Figma's native data model straight to the exact DTCG shape Style Dictionary consumes.

**Plugin identity** (`manifest.json`):
- Name: `Chopstick Token Export`
- Entry points: `dist/main.js` (sandbox), `dist/ui.html` (UI)
- `editorType`: `["figma"]`
- `networkAccess.allowedDomains`: `["none"]` — the plugin makes no network calls; the ZIP is generated and downloaded entirely client-side in the UI iframe.
- `documentAccess`: `"dynamic-page"`

---

## 2. Monorepo Context

The plugin lives inside `chopstick-figma-plugins/`:

```
chopstick-figma-plugins/
├── packages/
│   └── shared/          Shared CSS + TS utilities, consumed by every plugin
├── plugins/
│   └── token-export/     ← this plugin
├── .gitignore
└── README.md
```

Each plugin is self-contained (own `package.json`, `manifest.json`, `src/`), and imports shared code via relative paths into `packages/shared/`. There is no workspace tooling (no npm/yarn workspaces, no Turborepo) — it's plain relative imports across folders. This keeps each plugin independently buildable and easy to reason about in isolation.

### 2.1 Shared Package (`packages/shared/`)

This package has **no plugin-specific logic** — it is pure UI/infrastructure plumbing shared by every plugin in the repo, so future plugins (icon export, component audit, whatever comes next) don't have to reimplement status messaging or ZIP generation from scratch.

**`ts/index.ts`** — barrel export:
```ts
export { setStatus, clearStatus } from './status';
export { downloadZip, getDateTimestamp } from './zip';
```

**`ts/status.ts`** — manages a `#status` DOM element's class/text for loading/success/error states. Expects the consuming plugin's `ui.html` to have a `<div id="status">`.

**`ts/zip.ts`** — ZIP generation and download, driven by a caller-supplied JSZip constructor (the shared package has no `node_modules` of its own for Vite to resolve from, so each plugin passes in its own imported `JSZip`).

**`css/base.css`** — reset, body/h2/h3/p defaults, a `.hidden` utility class. Imported first in every plugin's `ui.css`.

**`css/components.css`** — shared UI component styles: loading/empty states, select-all/deselect-all toggle buttons, checkbox list + checkbox item, search bar, export button (`#exportBtn`), and status banner (`#status` with `.loading`/`.success`/`.error` variants).

---

## 3. Technical Stack

- **Vite** — build tool, manual two-build setup (no Plugma abstraction)
- **TypeScript**, strict mode
- **`@figma/plugin-typings`** — Figma Plugin API types
- **`vite-plugin-singlefile`** — inlines all UI assets into one HTML file (required because Figma's plugin iframe can't load external assets at runtime)
- **JSZip 3.10.x** — in-browser ZIP generation, imported directly in `ui.ts` as a normal ES module (bundled as a devDependency, not loaded via CDN)

### 3.1 Build Configuration

**`package.json` scripts**:
```json
"build": "vite build && vite build --mode ui && mv dist/src/ui.html dist/ui.html && rm -rf dist/src",
"dev": "vite build --watch & vite build --mode ui --watch"
```
Two separate Vite builds run per `npm run build`:
1. Default mode → builds `src/main.ts` as an IIFE library bundle → `dist/main.js` (the Figma sandbox code)
2. `--mode ui` → builds `src/ui.html` (and its inlined JS/CSS via `vite-plugin-singlefile`) → `dist/ui.js`, then the script moves the emitted `dist/src/ui.html` up to `dist/ui.html` and deletes the now-empty `dist/src/` folder.

**`vite.config.ts`** branches on `mode`:
- `mode === 'ui'`: uses `viteSingleFile()` plugin, target `es2017`, entry `src/ui.html`, output `[name].js`, `emptyOutDir: false` (so it doesn't wipe out `main.js` from the first build).
- default mode: target `es2017`, `emptyOutDir: true`, library build with entry `src/main.ts`, IIFE format, fixed output filename `main.js`.

**`tsconfig.json`**: target `ES2020`, strict mode, `moduleResolution: "bundler"`, `rootDir: ./src`, `outDir: ./dist`, Figma plugin typings in `typeRoots`.

---

## 4. Token Architecture (Conceptual Model)

The system is designed around a **two-tier token model**:

1. **Primitives** — raw values with no semantic meaning.
   - *Base primitives* are the complete, canonical set.
   - *Brand primitives* (e.g. Kiwi, Karumi) only define what's unique to that brand: typically `color`, `fontFamily`, `fontWeight`. Everything else falls through and semantic tokens reference base primitives directly.

2. **Semantics** — define intent, and reference primitives by alias. Token *names* are identical across brands; what differs per brand is which primitive each semantic name resolves to.

**Brand differentiation** is implemented via Figma's **extended collection** feature: a brand's collection extends/overrides the base semantic collection's mappings. The plugin detects this (`collection.isExtension`) and resolves brand-specific overrides (`collection.variableOverrides`) before falling back to the base value. This keeps brand-specific Figma work minimal — a new brand only needs to define what actually differs, not duplicate the entire token tree.

**Modes**: semantic tokens can have modes where applicable — `light`/`dark` for color, `desktop`/`tablet`/`mobile` for font and spacing. Primitive collections and some semantics are single-mode (output under a literal key `"default"` internally, which gets flattened away — see §6.3).

---

## 5. Export Rules (Business Logic, Independent of Code)

These rules apply uniformly across variables and text/effect styles:

| Rule | Behavior |
|---|---|
| **Excluded collections** | Collections named exactly `Assets` (by type) or `---` are excluded from the UI and never exported. |
| **`[export-plugin-ignore]`** | Any variable or style whose Figma description contains this literal string is skipped entirely, regardless of any other rule. This check always wins and is checked first. |
| **`-figma` suffix** | Any variable/style whose *name's last path segment* ends in `-figma` is excluded automatically. These exist purely to work around Figma limitations (e.g., a px-based shadow property that in the real token should be a `dimension` alias, or a text-style-bound value that needs a literal unit Figma can accept). |
| **Trailing `*`** | A `*` suffix on any path segment (e.g., `blue/550*`) marks a "brand book color that should not be modified" in Figma. The `*` is stripped during export — it carries no meaning in the output JSON. |
| **Path → JSON nesting** | Figma's `/`-delimited variable names become nested JSON objects. Alias references use dot notation inside `{...}` (e.g. `base/color/blue/550` → `{base.color.blue.550}`). |
| **Color descriptions** | Primitive color tokens get their computed HSL string in `$description` (derived from Figma's raw RGBA), so Storybook/docs can show HSL alongside hex. |
| **Collection sorting** | Collections sort alphabetically by their *second word* (the category — color, spacing, etc.), then by *first word* (brand) as tiebreaker. Collection names follow the `{brand} {type}` convention, e.g. `Base color`, `Kiwi spacing`. |
| **Motion collections** | Any collection whose derived type is `motion` is treated specially: sibling variables under the same parent path (`timing`, `duration`, optional `delay`) are assembled into one `$type: "transition"` composite. Individual motion variables are never exported standalone — only the assembled composite. |

---

## 6. File-by-File Breakdown (`src/`)

### 6.1 `main.ts` — Plugin Entry Point (Sandbox)

Runs in the Figma plugin sandbox (has access to the `figma` global, not the DOM).

**On load** (IIFE at module scope):
1. Fetches all local variable collections via `figma.variables.getLocalVariableCollectionsAsync()`.
2. Filters out `---` and `*-assets`-type collections, sorts per the rule above.
3. Checks four style types for at least one local style each: Text (`getLocalTextStylesAsync`), Effect (`getLocalEffectStylesAsync`), Grid (`getLocalGridStylesAsync`), Paint (`getLocalPaintStylesAsync`). Only style types with ≥1 style are surfaced to the UI as selectable.
4. Posts `{ type: 'data-loaded', collections, styleTypes }` to the UI, or `{ type: 'data-error', message }` on failure.

**On `start-export` message from the UI**:
1. Re-fetches all collections, filters to the user-selected names.
2. Builds a global `Map<variableId, variableName>` across *all* collections (not just selected ones) — this is necessary because an alias in a selected collection can point to a variable that lives in an unselected one; the full map ensures resolution always succeeds.
3. For each selected collection:
   - Extracts `isExtension` and `variableOverrides` (cast via `as any` since these aren't in the stable `@figma/plugin-typings` surface yet).
   - Derives `collectionType` from the collection name: second-and-later words, lowercased, with a trailing `" semantic"` suffix stripped (e.g. `"Base numeric semantic"` → `"numeric"`).
   - Resolves all variables in the collection (`getVariableByIdAsync` per ID) and normalizes modes.
   - **If `collectionType === 'motion'`**: routes to `buildMotionComposites()` (see §6.6) instead of the normal transformer.
   - Otherwise: routes to `transformCollection()` (§6.2), then `mapCollectionToFiles()` (§6.3) to get output file(s).
4. **Text styles** (if selected): calls `readTextStyles()` (§6.4), nests results under their path, and — if non-empty — emits exactly one file: `semantic/font/composite.json`.
5. **Effect styles** (if selected): calls `readEffectStyles()` (§6.7), groups results by their *first path segment* (so different effect families land in separate files — currently only `shadow` exists, but this scales to future groups like `glow`), and emits `semantic/{group}/composite.json` per non-empty group.
6. Grid and Paint style export are **stubbed as TODOs** — not implemented.
7. Posts `{ type: 'export', files: outputFiles }` on success, or `{ type: 'export-error', message }` on failure.

### 6.2 `transformer.ts` — Core Transformation Logic

This is the heart of the plugin. Exports:

**Color utilities**:
- `rgbToHex(r, g, b)` — 0–1 float RGB → `#rrggbb`.
- `rgbToHsl(r, g, b)` — 0–1 float RGB → `hsl(h, s%, l%)` string.
- `roundAlpha(alpha)` — rounds to 2 decimal places.
- `colorToValue(color: RGBA)` — returns hex if alpha is 1, else `rgba(r,g,b,a)` with rounded alpha. This is the `$value` for color tokens.
- `colorToHsl(color: RGBA)` — same logic but returns an HSL/HSLA string, used for the `$description`.

**Alias resolution**:
- `resolveAlias(variableId, allVariables)` — looks up the variable's name from the global map, strips trailing `*` from every path segment, converts `/` to `.`, wraps in `{...}`. Returns `''` if the variable isn't found (caller must check and skip).
- `nameToPath(name)` — splits a Figma variable/style name on `/`, drops empty segments, strips trailing `*` per segment. Returns a string array.
- `setNestedValue(obj, path, value)` — generic deep-set helper, creates intermediate objects as needed.

**DTCG type mapping** — the most important piece of domain logic:

```ts
const DTCG_TYPE_MAP: Record<string, { type: string; unit?: string; parse?: string }> = {
  fontFamily:    { type: 'fontFamily' },
  fontWeight:    { type: 'fontWeight' },
  fontSize:      { type: 'dimension', unit: 'px' },
  letterSpacing: { type: 'dimension', unit: 'em', parse: 'percentToDecimal' },
  lineHeight:    { type: 'number', parse: 'percentToDecimal' },
  spacing:       { type: 'dimension', unit: 'px' },
  gutter:        { type: 'dimension', unit: 'px' },
  margin:        { type: 'dimension', unit: 'px' },
  borderWidth:   { type: 'dimension', unit: 'px' },
  borderRadius:  { type: 'dimension', unit: 'px' },
  size:          { type: 'dimension', unit: 'px' },
  blur:          { type: 'dimension', unit: 'px' },
  duration:      { type: 'duration', unit: 'ms' },
  delay:         { type: 'duration', unit: 'ms' },
};
```

`resolveDTCGType(path)` walks the token's path **from deepest segment to shallowest** and returns the first match. This means the most specific/last-matching segment wins if there's ever ambiguity (there usually isn't, since these are mutually exclusive category names).

This map is **intentionally hardcoded**. Adding a new FLOAT-based token category that needs special DTCG typing (not just `number`/`string` defaults) requires a code change here and a rebuild — this is a deliberate simplicity-over-dynamism tradeoff, not an oversight. The alternative (a fully dynamic/configurable type map) would add indirection for a case — introducing a brand-new token category — that happens rarely enough that a code change and rebuild is an acceptable cost.

Two values in the map are not in this table because they're handled as native Figma variable *types* rather than path-segment matches: `TIMING` and `EASING` (Figma's native motion variable types — see `buildToken`'s dedicated branches below). `cubicBezier` parsing (`parse: 'cubicBezier'`) is referenced in the type signature but not currently assigned to any map entry — it's used for the `EASING` native-type branch instead, which is handled separately, not through the map.

**`percentToDecimal(value)`** — divides by 100. Figma stores `lineHeight` as `150` (meaning 150%) and `letterSpacing` as `1.5` (meaning 1.5%); both need this conversion. `lineHeight` becomes a unitless ratio (`1.5`), `letterSpacing` becomes `"0.015em"` (converted, then unit appended).

**`parseCubicBezier(value: string)`** — parses a comma-separated 4-number string (`"0.42, 0, 0.58, 1"`) into `[0.42, 0, 0.58, 1]`. Returns `null` if it doesn't parse to exactly 4 valid numbers.

**`cleanDescription(description)`** — strips the literal `[export-plugin-ignore]` substring from the description (in case it co-exists with other real description text) and trims; returns `undefined` if the result is empty (so `$description` is omitted from the output rather than serialized as `""`).

**`transformCollection(options: TransformOptions)`** — the main entry point:
- Iterates every variable in the collection.
- Skips `[export-plugin-ignore]`-tagged and `-figma`-suffixed variables immediately.
- **Single-mode collections**: builds one token per variable under a `result['default']` bucket.
- **Multi-mode collections**: builds one token per variable *per mode*, under `result[modeName.toLowerCase()]`.
- Delegates actual value construction to `buildToken()`.

**`getRawValue(variable, modeId, isExtension, variableOverrides, parentModeId)`** — resolves the correct raw Figma value for a variable at a given mode:
1. If the collection `isExtension`, check `variableOverrides[variable.id][modeId]` first — this is how brand collections override base semantic values.
2. Else/fallback: if `parentModeId` is present (this is the *actual* key under which Figma stores the value in `valuesByMode` for extended-mode scenarios), use that.
3. Final fallback: try `modeId` with any `/`-prefix stripped, then the raw `modeId` itself.

**`buildToken(type, rawValue, description, allVariables, path)`** — the per-token construction logic, branches in this priority order:
1. **Alias** (`rawValue.type === 'VARIABLE_ALIAS'`): resolves the reference via `resolveAlias`; `$type` comes from the DTCG map if the *referencing* token's path matches, else falls back to a generic Figma→DTCG type mapping (`figmaTypeToDTCG`). `$value` is always the `{alias.path}` string — aliases never carry resolved literal values.
2. **Color** (Figma `type === 'COLOR'`): always `$type: 'color'`, `$value` = hex/rgba via `colorToValue`, `$description` = HSL via `colorToHsl` (overwriting any literal Figma description — colors don't carry user descriptions in this pipeline).
3. **`TIMING`** (native Figma motion variable type): stored in seconds as a float; converted to whole milliseconds (`Math.round(value * 1000)`) to avoid floating-point noise, output as `"{ms}ms"` with `$type: 'duration'`.
4. **`EASING`** (native Figma motion variable type): reads `bezierValues` (`p1x, p1y, p2x, p2y`); emits `$type: 'cubicBezier'` with a 4-number array `$value`. **Springs have no DTCG equivalent** — an easing variable without bezier values is skipped with a `console.warn`, not exported.
5. **Mapped FLOAT/STRING via `DTCG_TYPE_MAP`**:
   - `parse: 'cubicBezier'` + `STRING` type → parses the string, skips (returns `null`) if parse fails.
   - `parse: 'percentToDecimal'` + `FLOAT` type → converts, appends unit if present.
   - Plain `FLOAT` with a unit → appends the unit as a string suffix (`16` → `"16px"`).
   - `fontWeight` mapping + `STRING` type → **does not use the Figma-stored value at all**. Instead derives the numeric weight by `parseInt`-ing the variable's *own last path segment* (e.g. a variable named `base/fontWeight/main/400` becomes `$value: 400`, regardless of what Figma's stored string value is, e.g. `"regular"`). This is a deliberate choice because Figma's word-value-to-number mapping (`"regular"` → 400, `"medium"` → 500, etc.) is inconsistent across font families; the token's own name is a more reliable source of truth. If the last segment doesn't parse to a number, the token is skipped with a `console.warn`.
   - Plain `STRING` with a mapping but no `parse` → kept as-is, with the mapped `$type` applied (this is the `fontFamily` case, among others).
6. **No mapping found**: default Figma→DTCG fallback — `FLOAT` → `$type: 'number'`, `STRING` → `$type: 'string'`. Anything else (e.g. `BOOLEAN` without a mapping) returns `null` and is silently skipped.

**`figmaTypeToDTCG(type)`** — simple switch used only for the alias branch when no path-based mapping exists: `COLOR→color`, `FLOAT→number`, `STRING→string`, `BOOLEAN→boolean`, `TIMING→duration`, `EASING→cubicBezier`, default → lowercased type string.

### 6.3 `output.ts` — Dynamic Output File Path Mapping

Converts a `transformCollection()` result into one or more `{path, content}` file objects, with **zero hardcoded brand or category names** — everything is derived from the collection name string. This is deliberate: it means a new brand or category added in Figma produces correctly-pathed output with no plugin code changes.

**`mapCollectionToFiles(collectionName, transformed)`**:
- Collection name is split on spaces: `parts[0]` = brand (lowercased), `parts.slice(1).join(' ')` = type, with a trailing `" semantic"` suffix stripped (classification word, not a path segment).
- **`type === 'primitive'`**: single file at `primitive/{brand}.json`. Empty output → no file emitted (returns `[]`).
- **`type === 'numeric'`**: routes to `splitByFirstSegment()` — see below. This is for collections like "Base numeric semantic" that bundle multiple otherwise-separate categories (borderRadius, font, spacing, etc.) into one Figma collection but need separate output files per category.
- **Everything else**: single file at `semantic/{type-with-spaces-as-dashes}/{brand}.json`.

**`splitByFirstSegment(brand, transformed)`**:
- First calls `mergeResult()` to collapse the mode-keyed structure.
- Detects whether the merged result is mode-prefixed (`{ desktop: {...}, tablet: {...} }`) or flat (no modes) by checking if the first top-level value is itself an object without a `$type` key.
- **Mode-prefixed**: collects the union of first-level segment names across *all* modes (since not every mode necessarily has every segment), then builds one output file per segment, with that segment's sub-tree preserved under each mode key it appears in. Path: `semantic/{segment}/{brand}.json`.
- **Flat**: splits directly by first-level key, one file per key.

**`mergeResult(transformed)`**:
- If there's a `'default'` key and no other mode keys, returns it as-is (single-mode collection, nothing to merge).
- If there are mode keys, **deep-merges `default` tokens into each mode** via `deepMerge()` — this lets single-mode ("static," applies-to-all-modes) tokens coexist with mode-specific ones in the same collection, with the mode-specific values taking precedence.

**`deepMerge(base, override)`**: recursive object merge. A key is merged recursively only if override's value at that key is a plain object *without* a `$value` property (i.e., it's a further nesting level, not a token leaf) **and** the base has an object at the same key. Otherwise override wins outright (this correctly treats a DTCG token object, which always has `$value`, as a leaf to be replaced wholesale rather than merged key-by-key).

### 6.4 `font.ts` — Typography Composite Token Export

Reads Figma **local text styles** (not variables) and converts each into a single DTCG **typography composite token** (`$type: 'typography'`).

**`readTextStyles(allVariables)`**:
- Fetches `figma.getLocalTextStylesAsync()`.
- Skips styles whose name's last segment ends in `-figma`, and styles tagged `[export-plugin-ignore]`.
- For each remaining style, builds a typography token via `buildTypographyToken()` and records its path (from the style's `/`-split, trimmed name).

**`buildTypographyToken(style, allVariables)`** builds a `$value` object with exactly five properties: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`. Each is resolved independently:
- If the style has a bound variable for that property, output is `{cleanAliasName}` (an alias reference).
- Otherwise, falls back to the style's literal value, formatted per-property (see resolvers below).

**`cleanAliasName(name)`** — the alias-cleaning logic here is *more aggressive* than `transformer.ts`'s `resolveAlias`: it strips both the trailing `*` **and** a trailing `-figma` suffix per path segment. This exists because of a specific workaround: Figma text styles cannot bind percentage or unitless values for `lineHeight`/`letterSpacing`, so a parallel `-figma` variable (holding a px-equivalent value) is created purely so it *can* be bound to the text style property. The real semantic token (without `-figma`) is what the exported composite should reference — so this function rewrites the bound variable's name to strip the `-figma` suffix before building the alias reference. This means the composite always points at the "real" semantic token, never at its `-figma` Figma-only counterpart.

**Resolvers**:
- `resolveProperty(boundVar, fallback, allVariables)` — generic: alias if bound, else the literal fallback string.
- `resolveLineHeight(boundVar, lineHeight, allVariables)` — alias if bound; else `'normal'` if `unit === 'AUTO'`, else `"{value}%"` (PERCENT) or `"{value}px"`.
- `resolveLetterSpacing(boundVar, letterSpacing, allVariables)` — alias if bound; else `"{value}%"` (PERCENT) or `"{value}px"`.

**Known constraint**: Figma text styles do not support modes. The composite token therefore always captures the *bare* alias path (e.g. `{font.action.button.fontSize}`), but the actual semantic tokens it references live under mode-prefixed keys (`desktop.font.action.button.fontSize`, etc.). **Style Dictionary cannot resolve this without a custom preprocessor and format** — see §8 for the reference solution.

### 6.5 `effect.ts` — Shadow Effect Style Export

Mirrors `font.ts`'s pattern but for Figma **local effect styles**, producing DTCG **shadow composite tokens** (`$type: 'shadow'`).

**`readEffectStyles(allVariables)`**:
- Fetches `figma.getLocalEffectStylesAsync()`.
- Skips `-figma`-suffixed and `[export-plugin-ignore]`-tagged styles.
- Filters each style's `effects` array to only `DROP_SHADOW` / `INNER_SHADOW` types (via `isShadowEffect` type guard) with `visible !== false`. **Other effect kinds** (layer blur, background blur, noise, texture) have no DTCG shadow equivalent and are silently excluded from consideration — a style containing *only* non-shadow effects produces no token at all.
- A style with exactly one qualifying shadow effect emits a single shadow object as `$value`; a style stacking multiple shadow effects emits an **array** of shadow objects, in Figma's own effect order.

**`buildShadowValue(effect, allVariables)`** produces:
```ts
{ color, offsetX, offsetY, blur, spread, inset: boolean }
```
Each of `color`/`offsetX`/`offsetY`/`blur`/`spread` is resolved the same way: alias reference if the property is variable-bound, else a literal fallback. **Important asymmetry vs. `font.ts`**: a bound dimension property carries its unit through the *referenced token* (so no unit is appended to the alias string), but an *unbound* dimension is a raw Figma px number and gets `"px"` appended directly in the resolver (`resolveDimension`). `inset` is simply `effect.type === 'INNER_SHADOW'`.

### 6.6 `motion.ts` — Motion Transition Composite Builder

Figma cannot store composite values directly in a single variable, so motion properties are modeled as **separate sibling variables under a shared parent path**:
```
motion/fade/timing    → alias {base.timing.ease-in-out}
motion/fade/duration  → alias {base.duration.normal}
motion/fade/delay     → alias {base.delay.none}   (optional)
```
This module groups them back together into one DTCG `$type: "transition"` composite per group, and **only the composite is exported** — individual motion variables are never output standalone.

**`MOTION_PROPERTY_MAP`**: maps a variable's last path segment to its DTCG transition property name: `timing → timingFunction`, `duration → duration`, `delay → delay`. Any variable whose last segment doesn't match one of these three is ignored entirely by this module (it would need to belong to a non-motion collection to be exported via the normal transformer instead).

**`buildMotionComposites(variables, modes, isExtension, variableOverrides, allVariables)`**:
1. Filters out `[export-plugin-ignore]`-tagged and `-figma`-suffixed variables.
2. Groups remaining variables by **parent path** (everything except the last segment) into a `Map<parentKey, Map<propertyName, variable>>`.
3. A group is only assembled if it has **at minimum both `timing` and `duration`** — `delay` is optional, and a group missing `timing` or `duration` is dropped entirely (not partially exported).
4. For single-mode collections, output goes under `result['default']`; for multi-mode, output is built per mode.
5. `assembleTransition()` resolves each property's raw value (reusing the same override/parentModeId resolution logic as `transformer.ts`'s `getRawValue`, duplicated locally as `getMotionRawValue` rather than imported — worth noting if consolidating later) and **requires the value to be a `VARIABLE_ALIAS`** — motion semantics in this system are always expected to be aliases, never literals. If `timingFunction` or `duration` fails to resolve to an alias, the whole composite is dropped (`null`).

This module imports `resolveAlias` and `nameToPath` from `transformer.ts`, but duplicates the raw-value-resolution and nested-set logic locally rather than importing/sharing it.

### 6.7 `utils.ts`

Currently **empty**. Reserved for future shared utilities specific to this plugin (distinct from `packages/shared/`, which is shared *across* plugins). No content to document.

### 6.8 UI Layer (`ui.html`, `ui.ts`, `ui.css`)

Pure vanilla TypeScript + DOM, no framework — kept deliberately lightweight since the UI's only job is selecting collections/styles and triggering export, not rendering complex state.

**`ui.html`**: static shell with a loading state (`#loading`), two collapsible panels (`#panels` containing a collections checkbox list and a styles checkbox list), an empty-state message, an export button (`#exportBtn`, disabled by default), and a `#status` div. Imports `ui.css` via `<link>` and `ui.ts` as a module script.

**`ui.ts`**:
- Maintains two `Set<string>` state objects: `selectedCollections`, `selectedStyleTypes`. Both default to **all items selected** (every checkbox is checked on render, and immediately added to its state set).
- `updateExportButton()` — disables the export button only when *both* sets are empty.
- `renderCheckboxList(container, items, stateSet)` — generic renderer; wires each checkbox's `change` event to add/remove from the state set and re-evaluate the export button.
- A single delegated `click` listener on `document` handles all "Select all" / "Deselect all" buttons (`.toggle-btn` with `data-target` and `data-action` attributes), so new panels don't need bespoke wiring.
- `handleDataLoaded(collections, styleTypes)` — hides the loading state, shows the empty state if nothing was found, otherwise renders both checkbox lists (styles panel only shown if there's at least one available style type).
- On export click: disables the button, clears/sets status to `'loading'`, and posts `{ type: 'start-export', selectedCollections, selectedStyleTypes }` to the plugin sandbox via `parent.postMessage`.
- `window.onmessage` handles four message types from the sandbox: `data-loaded`, `data-error`, `export` (stringifies each file's JSON content with 2-space indent, then calls the shared `downloadZip()` with prefix `'chopstick-tokens'` and the imported `JSZip` class), and `export-error`.

**`ui.css`**: imports the two shared stylesheets first, then plugin-specific layout for the panels container and collection list (flex column, scroll containment).

---

## 7. End-to-End Data Flow Summary

```
Figma file
  │
  ├─ Variable Collections ──► main.ts (filter/sort) ──► UI checkbox list
  │                                                         │
  └─ Local Styles (text/effect/grid/paint) ──► UI checkbox list (only non-empty types shown)
                                                             │
                                                      user selects + clicks Export
                                                             │
                                                             ▼
                                              main.ts: start-export handler
                                                             │
                     ┌───────────────────────────────────────┼─────────────────────────────┐
                     ▼                                       ▼                             ▼
          Variable collections                        Text styles                   Effect styles
                     │                                       │                             │
         is collectionType === 'motion'?             readTextStyles()             readEffectStyles()
            │yes              │no                        (font.ts)                   (effect.ts)
            ▼                 ▼                             │                             │
   buildMotionComposites  transformCollection                │                             │
      (motion.ts)          (transformer.ts)                  │                             │
            │                 │                              │                             │
            └────► mapCollectionToFiles() (output.ts) ◄──────┘                             │
                            │                                                              │
                 grouped into semantic/font/composite.json              grouped by first path segment
                                                                     into semantic/{group}/composite.json
                            │                                              │
                            └──────────────┬───────────────────────────────┘
                                            ▼
                                     outputFiles[]
                                            │
                                   posted to UI as 'export'
                                            │
                                   ui.ts stringifies each file
                                            │
                               downloadZip() (packages/shared/ts/zip.ts)
                                            │
                            chopstick-tokens-YYYYMMDD.zip downloaded
```

---

## 8. Downstream Consumption: Style Dictionary v4

The plugin's own `examples/` folder contains a **reference Style Dictionary v4 config** (`sd.config.mjs`) solving two problems inherent to the export format:

1. **Font composite alias resolution**: font composite tokens (`$type: 'typography'`) reference bare paths (e.g. `{font.x.fontSize}`) that don't exist in the token tree as-is (see §6.4's note on modes). A custom **preprocessor** (`escape-composite-aliases`) rewrites these references to a safe placeholder format (`__ref__path.to.token`) before Style Dictionary's native resolution would otherwise throw on the unresolvable bare path. A custom **format** (`css/font-responsive`) then expands each placeholder into a desktop-first responsive CSS block, mapping each composite property to its mode-prefixed token per breakpoint (`desktop` = base/no media query, `tablet` = `max-width: var(--breakpoint-md)`, `mobile` = `max-width: var(--breakpoint-xs)`).

2. **Spacing/responsive font semantic collapsing**: mode-prefixed tokens (`desktop.spacing.x`, `tablet.spacing.x`, `mobile.spacing.x`) resolve fine individually through Style Dictionary, but its built-in formats would emit them as three unrelated flat variables rather than one responsive variable. A custom format (`css/spacing-responsive`) detects tokens sharing a common path across all three mode prefixes and collapses them into one `--spacing-x` variable with the same desktop-first media-query structure.

**Known limitations of the reference config**: CSS output only — a JS/TS format for Web Components consumption isn't built yet; it uses `:root` as the output selector, which may need to become brand-scoped (`[data-brand="{brand}"]`) or shadow-DOM-scoped depending on how the dev team's Web Components architecture wants to consume it.

This Style Dictionary config will be consumed by a separate development team. Any change to the plugin's token *shape* (e.g., a future fontWeight format change) must land in coordination with that team's config, since a shape change here can silently break their build.

---

## 9. Extensibility Model (By Design, No Code Required)

- **New brand**: adding `{Brand} color`, `{Brand} primitive`, etc. collections in Figma, following the `{brand} {type}` naming convention, automatically produces correctly-pathed output files — no plugin code changes needed.
- **New token category** whose Figma type already maps correctly by default (`FLOAT → number`, `STRING → string`): also needs no code changes — e.g. adding `Base elevation` produces `semantic/elevation/base.json` automatically.
- **New token category needing special DTCG typing** (e.g. a new FLOAT-based category that should render as `dimension` + `px`, not plain `number`): **requires a code change** — a new entry in `DTCG_TYPE_MAP` inside `transformer.ts`, followed by a rebuild. This is the one deliberate "manual" seam in an otherwise convention-driven system.
- **New style type** (grid, paint): the UI will surface it automatically once Figma reports at least one local style of that type, but the actual *export logic* for grid/paint is currently just a `// TODO` stub in `main.ts` — selecting them in the UI does nothing on export today.

---

## 10. Known Behaviors Worth Understanding

These aren't bugs, but they're easy to miss when maintaining or extending this logic:

- **Alias resolution always wins over mapped DTCG type for `$value`**, but the `$type` on an alias token still comes from the DTCG map applied to *its own* path — not from the type of the variable it points to. This means an alias's declared `$type` reflects where it lives in the tree, not necessarily the resolved type of its target (though in practice these should always agree if the token architecture is followed correctly).
- **`fontWeight` derivation deliberately ignores the Figma-stored value** and parses the variable's own last path segment instead. This is a correctness decision, not a shortcut — do not "fix" this to read the Figma value directly without understanding why (word-to-number maps are inconsistent across font families).
- **Motion composites require both `timing` AND `duration`** to exist in the same parent-path group; a group with only one of these produces nothing, silently.
- **Effect/shadow export silently ignores non-shadow effects** inside a style; a style that contains only blur/noise effects (no drop/inner shadow) produces zero tokens, with no warning.
- **The global `allVariables` alias map is built from *all* collections, not just selected ones** — this is required for correct alias resolution and must be preserved in any rework; narrowing it to only selected collections would break cross-collection aliases.
- **`mergeResult()`'s deep merge treats any object with a `$value` key as a leaf**, even if it's nested several levels deep — this is how it distinguishes "a token to overwrite" from "a further path segment to recurse into." Any rebuild of this merge logic must preserve that distinction.
