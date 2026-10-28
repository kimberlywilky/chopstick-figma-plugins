# Chopstick Token Export Plugin

A custom Figma plugin for the Chopstick design system. It reads Figma variables and text/effect styles, transforms them into the W3C Design Token Community Group (DTCG) format, and exports them as a dated ZIP file ready for Style Dictionary v4.

For a deeper technical walkthrough of every file and design decision, see [`ARCHITECTURE_REFERENCE.md`](./ARCHITECTURE_REFERENCE.md).


## Why a Custom Plugin

Every available token export tool outputs tokens in its own schema, but Style Dictionary v4 expects DTCG-compliant JSON. Regardless of which tool is used, a custom transformation script is always required to bridge the gap. Rather than maintaining middleware on top of a third-party tool, the plugin outputs tokens directly in the exact format Style Dictionary expects, eliminating the transformation layer entirely.


## Running the Plugin

### Technical Stack

- **Vite** -- Build tooling (manual two-build setup, no Plugma abstraction)
- **TypeScript** -- Language
- **@figma/plugin-typings** -- Figma Plugin API types
- **vite-plugin-singlefile** -- Inlines UI assets into a single HTML file for Figma's iframe constraint
- **JSZip 3.10.x** -- ZIP file generation in the browser

### Development

```bash
cd plugins/token-export
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
3. Select `plugins/token-export/manifest.json`
4. Open your Chopstick Figma file
5. Run the plugin from Plugins > Development > Chopstick Token Export

> **Note on `manifest.json`'s `id` field**: it's currently set to a placeholder (`"REPLACE_ON_IMPORT"`). Figma typically assigns a real plugin ID automatically the first time you import or publish a dev plugin locally — if Figma Desktop rejects the placeholder on import, replace it with any string; Figma will overwrite it with a real ID on first publish.

### Export Output

The plugin generates a dated ZIP file named `chopstick-tokens-YYYYMMDD.zip` in your downloads folder.


## Token Architecture

The system is designed around a two-tier token model:

**Primitives** are raw values with no semantic meaning. Base primitives are the most complete set. Brand primitives only define what is unique to their brand: color, fontFamily, fontWeight. For everything else, semantic tokens reference base primitives directly.

**Semantics** define intent and map to primitives. Token names are identical across brands; what changes per brand is which primitive value each semantic token resolves to.

Brand differentiation is handled through Figma's extended collection feature, where brand collections override base semantic mappings. The plugin detects extended collections and resolves the correct brand values before outputting references.

Semantic tokens support modes where applicable: light/dark for color, desktop/tablet/mobile for font and spacing.


## Output Structure

Output file paths are dynamically derived from collection names using a `{brand} {type}` naming convention. If the type is `primitive`, the file goes to `primitive/{brand}.json`. Otherwise it goes to `semantic/{type}/{brand}.json`.

```
tokens/
├── primitive/
│   └── {brand}.json
└── semantic/
    ├── border/
    │   └── {brand}.json
    ├── color/
    │   └── {brand}.json
    ├── font/
    │   ├── {brand}.json
    │   └── composite.json
    ├── layout/
    │   └── {brand}.json
    └── spacing/
        └── {brand}.json
```

### Token Format

Every token uses DTCG format with `$value`, `$type`, and optionally `$description`:

```json
{
  "color": {
    "common": {
      "focus": {
        "$type": "color",
        "$value": "{base.color.blue.550}",
        "$description": "hsl(221, 100%, 45%)"
      }
    }
  }
}
```

Alias tokens use curly-brace dot notation for references, which Style Dictionary resolves to the actual primitive value during its build step.

### Responsive Tokens and Style Dictionary

Some exported tokens require custom handling in Style Dictionary to produce responsive output. A reference implementation covering both cases (font composites and mode-prefixed spacing/font tokens), along with detailed documentation, is available in the [`examples/`](./examples/) folder.


## Export Rules

The plugin applies the following rules during export:

- **Excluded collections:** Collections named `Assets` and `---` are excluded from the UI and never exported.
- **Ignored tokens:** Any variable or text style with `[export-plugin-ignore]` in its Figma description is skipped entirely.
- **Figma-only tokens:** Any variable or text style whose name ends with `-figma` is automatically excluded. These are Figma-specific tokens (e.g., px-based values for properties that require percentage or unitless values in the real output) that exist only to work around Figma limitations.
- **Trailing asterisk:** The `*` suffix on token names is stripped during export, intended to mark a brand book color that should not be modified.
- **Path conversion:** Token path separators use `/` in Figma and are converted to nested JSON objects. Alias references use dot notation: `base/color/blue/550` becomes `{base.color.blue.550}`.
- **Color descriptions:** Primitive color tokens include their HSL value in `$description`, calculated from the raw RGBA value provided by Figma's Plugin API.
- **Collection sorting:** Collections are sorted alphabetically by the second word of their name (the token category), then by the first word (the brand) as a tiebreaker.
- **Motion collections:** Collections whose type is `motion` are treated as composites. Sibling variables under the same parent path (timing, duration, and optionally delay) are assembled into a single `$type: "transition"` composite token. Individual motion variables are not exported.

### DTCG Type Mapping

Figma stores all numeric values as FLOAT and text values as STRING, but the DTCG spec requires more specific types. The plugin maps token types based on the token's path. When a token's path contains a recognized segment, the DTCG type and value format override the default Figma type. Tokens that don't match any mapping fall through to the default behavior (FLOAT becomes `number`, STRING stays `string`).

| Token path segment | DTCG type | Value transformation |
|---|---|---|
| `fontFamily` | `fontFamily` | No change (string value kept as-is) |
| `fontWeight` | `fontWeight` | No change (string value kept as-is) |
| `fontSize` | `dimension` | Append `px` (e.g., `16` becomes `"16px"`) |
| `lineHeight` | `number` | Divide by 100 (e.g., `150` becomes `1.5`) |
| `letterSpacing` | `dimension` | Divide by 100, append `em` (e.g., `1.5` becomes `"0.015em"`) |
| `spacing` | `dimension` | Append `px` |
| `gutter` | `dimension` | Append `px` |
| `margin` | `dimension` | Append `px` |
| `borderWidth` | `dimension` | Append `px` |
| `borderRadius` | `dimension` | Append `px` |
| `duration` | `duration` | Append `ms` (e.g., `200` becomes `"200ms"`) |
| `delay` | `duration` | Append `ms` |
| `timing` | `cubicBezier` | Parse string into array (e.g., `"0.42, 0, 0.58, 1"` becomes `[0.42, 0, 0.58, 1]`) |

Alias tokens (references to other variables) inherit the mapped `$type` but keep their reference string as `$value`. Tokens not listed above use their default Figma type mapping.


## Extending the Plugin

Adding new collections, brands, or style types requires no code changes for the UI or output paths, provided the `{brand} {type}` naming convention is followed. New collections will automatically appear in the plugin UI and generate the correct output paths. New style types will appear when they have at least one local style in the Figma file.

However, if a new token category uses a Figma type that doesn't match its DTCG type (e.g., a new FLOAT-based token that should be `dimension` with `px`), an entry needs to be added to the `DTCG_TYPE_MAP` in `transformer.ts`. Without it, the token will fall through to the default mapping (FLOAT becomes `number`, STRING becomes `string`).


## Repository Structure

```
token-export/
├── src/
│   ├── main.ts            Figma plugin entry point (sandbox)
│   ├── transformer.ts     Token transformation and DTCG type mapping
│   ├── output.ts          Dynamic file path mapping
│   ├── font.ts             Typography text style reader
│   ├── effect.ts           Shadow effect style reader
│   ├── motion.ts           Motion transition composite builder
│   ├── ui.html             Plugin UI markup
│   ├── ui.ts               Plugin UI logic
│   ├── ui.css              Plugin UI styles
│   └── utils.ts            Shared utilities (reserved, empty)
├── examples/
│   ├── README.md           Style Dictionary responsive token documentation
│   └── sd.config.mjs       Style Dictionary v4 reference config
├── ARCHITECTURE_REFERENCE.md  Full technical reference: every file, every design decision
├── dist/                  Built output (gitignored)
├── manifest.json          Figma plugin manifest
├── vite.config.ts         Vite build configuration
├── tsconfig.json          TypeScript configuration
└── package.json           Dependencies and scripts
```
