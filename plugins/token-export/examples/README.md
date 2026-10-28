# Style Dictionary v4 - Responsive Token Examples

Reference implementation for consuming the Chopstick Token Export plugin output with Style Dictionary v4. This config demonstrates how to generate desktop-first responsive output for font composite tokens and spacing tokens.

The two problems it solves (unresolvable composite aliases, and collapsing mode-prefixed tokens into one responsive variable) are structural consequences of exporting from Figma's data model. 

## The Problem

### Font composites

Font composite tokens (exported from Figma text styles) contain alias references like `{font.x.fontSize}` that Style Dictionary cannot resolve. Figma text styles do not support modes, so the composite captures the bare path. The actual semantic tokens live under mode-prefixed keys:

- `desktop.font.x.fontSize`
- `tablet.font.x.fontSize`
- `mobile.font.x.fontSize`

For example, given a composite token:

```json
{
  "action": {
    "button": {
      "$type": "typography",
      "$value": {
        "fontFamily": "{font.action.button.fontFamily}",
        "fontSize": "{font.action.button.fontSize}",
        "fontWeight": "{font.action.button.fontWeight}",
        "lineHeight": "{font.action.button.lineHeight}",
        "letterSpacing": "{font.action.button.letterSpacing}"
      }
    }
  }
}
```

The bare path `{font.action.button.fontSize}` does not exist in the token tree. Without a custom preprocessor and format, Style Dictionary throws unresolved reference errors.

### Spacing

Spacing tokens resolve normally through Style Dictionary, but the built-in format outputs three separate flat tokens (`desktop.spacing.x`, `tablet.spacing.x`, `mobile.spacing.x`) rather than collapsing them into a single responsive `spacing.x` that changes value per breakpoint.

The same applies to responsive font semantic tokens (e.g. `desktop.font.x.fontSize`), which are individual tokens that follow the same mode-prefix collapsing logic as spacing.


## What the Reference Config Does

The `sd.config.mjs` file includes three custom pieces:

**Preprocessor (`escape-composite-aliases`):** Escapes font composite alias references so Style Dictionary treats them as plain strings instead of attempting resolution on bare paths that do not exist in the token tree.

**Custom format (`css/font-responsive`):** Filters for font composite tokens, maps each composite alias to its mode-prefixed token reference per breakpoint, and generates a desktop-first responsive output. Each breakpoint outputs the full set of composite properties (fontFamily, fontSize, fontWeight, lineHeight, letterSpacing).

**Custom format (`css/spacing-responsive`):** Detects spacing tokens that share a common path across all three mode prefixes, strips the prefix to produce a single responsive variable, and generates the same desktop-first responsive output.


## Responsive Strategy

The output follows a desktop-first approach using breakpoint tokens:

- Desktop values are the base (no breakpoint override)
- Tablet overrides at `breakpoint-md` (using `max-width`)
- Mobile overrides at `breakpoint-xs` (using `max-width`)

### Expected CSS output for font composites

```css
/* Desktop (base) */
:root {
  --action-button-font-family: var(--desktop-font-action-button-font-family);
  --action-button-font-size: var(--desktop-font-action-button-font-size);
  --action-button-font-weight: var(--desktop-font-action-button-font-weight);
  --action-button-line-height: var(--desktop-font-action-button-line-height);
  --action-button-letter-spacing: var(--desktop-font-action-button-letter-spacing);
}

/* Tablet */
@media (max-width: var(--breakpoint-md)) {
  :root {
    --action-button-font-family: var(--tablet-font-action-button-font-family);
    --action-button-font-size: var(--tablet-font-action-button-font-size);
    --action-button-font-weight: var(--tablet-font-action-button-font-weight);
    --action-button-line-height: var(--tablet-font-action-button-line-height);
    --action-button-letter-spacing: var(--tablet-font-action-button-letter-spacing);
  }
}

/* Mobile */
@media (max-width: var(--breakpoint-xs)) {
  :root {
    --action-button-font-family: var(--mobile-font-action-button-font-family);
    --action-button-font-size: var(--mobile-font-action-button-font-size);
    --action-button-font-weight: var(--mobile-font-action-button-font-weight);
    --action-button-line-height: var(--mobile-font-action-button-line-height);
    --action-button-letter-spacing: var(--mobile-font-action-button-letter-spacing);
  }
}
```

### Expected CSS output for spacing

```css
/* Desktop (base) */
:root {
  --spacing-x: var(--desktop-spacing-x);
}

/* Tablet */
@media (max-width: var(--breakpoint-md)) {
  :root {
    --spacing-x: var(--tablet-spacing-x);
  }
}

/* Mobile */
@media (max-width: var(--breakpoint-xs)) {
  :root {
    --spacing-x: var(--mobile-spacing-x);
  }
}
```


## Limitations

This reference covers CSS output only. Given Chopstick's stack is CSS Modules + Web Components (not Sass + React), a JS/TS token format may be worth adding for runtime or build-time consumption inside Web Components — not yet built here. See the plugin's README for the full list of formats Style Dictionary v4 supports.

The config uses `:root` as the selector. Confirm with the dev team whether Chopstick's brand-scoping approach needs a different selector strategy (e.g. `[data-brand="{brand}"]`) or something suited to a Web Components architecture (e.g. scoping within each component's shadow DOM via `:host`).


## Usage

```bash
# 1. Extract the plugin ZIP into a tokens/ directory
# 2. Copy sd.config.mjs to your project root
# 3. Install Style Dictionary
npm install style-dictionary@4
# 4. Build
npx style-dictionary build --config sd.config.mjs
```

Output files are generated in `build/css/`:

- `variables.css` -- all non-typography tokens (primitives, semantic color, border, etc.)
- `font.css` -- font composite tokens with responsive media queries
- `spacing.css` -- spacing tokens with responsive media queries
