// ─── Style Dictionary v4 — Responsive Font & Spacing Example ─────────────────
//
// This config demonstrates how to consume the Chopstick Token Export plugin
// output and generate responsive CSS for font composite tokens and spacing
// tokens.
//
// Font composites: alias references like {font.x.y} do not exist in the token
// tree. The real tokens live under mode prefixes (desktop.font.x.y, etc.).
// A preprocessor escapes these before SD attempts resolution.
//
// Spacing: tokens resolve normally but need to be collapsed from three
// mode-prefixed tokens into a single responsive variable.
//
// NOTE: Chopstick's consuming stack is CSS Modules + Web Components, not
// Sass + React, so this CSS-only reference config should still be directly
// usable. If Chopstick's dev team wants additional output formats (e.g. a
// JS/TS token module for use inside Web Components), those formats are not
// yet built here -- see the plugin's README for the list of formats Style
// Dictionary v4 supports natively.
//
// Usage:
//   1. Extract the plugin ZIP into a tokens/ directory
//   2. Copy this file to your project root
//   3. npm install style-dictionary@4
//   4. npx style-dictionary build --config sd.config.mjs
// ─────────────────────────────────────────────────────────────────────────────

import StyleDictionary from 'style-dictionary';

// ─── Configuration ───────────────────────────────────────────────────────────

const MODES = ['desktop', 'tablet', 'mobile'];

const BREAKPOINT_MAP = {
  tablet: 'var(--breakpoint-md)',
  mobile: 'var(--breakpoint-xs)',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function camelToDash(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function toVar(segments, mode) {
  const dashed = segments.map(s => camelToDash(s));
  return `var(--${mode}-${dashed.join('-')})`;
}

// ─── Preprocessor: Escape Font Composite Aliases ─────────────────────────────
//
// Font composite tokens reference bare paths (e.g. {font.x.y}) that SD cannot
// resolve. This escapes them so SD treats them as plain strings.

StyleDictionary.registerPreprocessor({
  name: 'escape-composite-aliases',
  preprocessor: (dictionary) => {
    function walk(obj) {
      for (const key in obj) {
        if (typeof obj[key] !== 'object' || obj[key] === null) continue;

        if (obj[key].$type === 'typography' && typeof obj[key].$value === 'object') {
          for (const prop in obj[key].$value) {
            const val = obj[key].$value[prop];
            if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
              obj[key].$value[prop] = `__ref__${val.slice(1, -1)}`;
            }
          }
        } else {
          walk(obj[key]);
        }
      }
    }

    walk(dictionary);
    return dictionary;
  },
});

// ─── Custom Format: Responsive Font Composites ──────────────────────────────
//
// Generates desktop-first responsive CSS from font composite tokens.
// Each composite property references its mode-prefixed semantic token.

StyleDictionary.registerFormat({
  name: 'css/font-responsive',
  format: ({ dictionary }) => {
    const tokens = dictionary.allTokens.filter(t => t.$type === 'typography');
    if (tokens.length === 0) return '/* No font composite tokens found */\n';

    const groups = Object.fromEntries(MODES.map(m => [m, []]));

    for (const token of tokens) {
      const baseName = token.path.join('-');

      for (const mode of MODES) {
        for (const [prop, rawVal] of Object.entries(token.$value)) {
          if (typeof rawVal !== 'string' || !rawVal.startsWith('__ref__')) continue;

          const barePath = rawVal.replace('__ref__', '').split('.');
          const cssVar = toVar(barePath, mode);
          groups[mode].push(`  --${baseName}-${camelToDash(prop)}: ${cssVar};`);
        }
      }
    }

    return buildResponsiveCSS(groups);
  },
});

// ─── Custom Format: Responsive Spacing ───────────────────────────────────────
//
// Collapses mode-prefixed spacing tokens into single responsive variables.
// e.g. desktop.spacing.x, tablet.spacing.x, mobile.spacing.x → --spacing-x

StyleDictionary.registerFormat({
  name: 'css/spacing-responsive',
  format: ({ dictionary }) => {
    // Group tokens by their base path (without the mode prefix)
    const tokensByBase = new Map();

    for (const token of dictionary.allTokens) {
      const [mode, ...rest] = token.path;
      if (!MODES.includes(mode)) continue;

      const basePath = rest.join('-');
      if (!tokensByBase.has(basePath)) tokensByBase.set(basePath, {});
      tokensByBase.get(basePath)[mode] = token.path;
    }

    // Only include tokens that exist across all three modes
    const groups = Object.fromEntries(MODES.map(m => [m, []]));

    for (const [basePath, modes] of tokensByBase) {
      if (MODES.some(m => !modes[m])) continue;

      for (const mode of MODES) {
        const cssVar = toVar(modes[mode], mode);
        groups[mode].push(`  --${basePath}: ${cssVar};`);
      }
    }

    if (groups.desktop.length === 0) return '/* No responsive spacing tokens found */\n';

    return buildResponsiveCSS(groups);
  },
});

// ─── Shared: Build Responsive CSS ────────────────────────────────────────────

function buildResponsiveCSS(groups) {
  const lines = [];

  lines.push('/* Desktop (base) */');
  lines.push(':root {');
  lines.push(...groups.desktop);
  lines.push('}');

  lines.push('');
  lines.push('/* Tablet */');
  lines.push(`@media (max-width: ${BREAKPOINT_MAP.tablet}) {`);
  lines.push('  :root {');
  lines.push(...groups.tablet.map(l => '  ' + l));
  lines.push('  }');
  lines.push('}');

  lines.push('');
  lines.push('/* Mobile */');
  lines.push(`@media (max-width: ${BREAKPOINT_MAP.mobile}) {`);
  lines.push('  :root {');
  lines.push(...groups.mobile.map(l => '  ' + l));
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ─── Style Dictionary Config ─────────────────────────────────────────────────

export default {
  usesDtcg: true,
  preprocessors: ['escape-composite-aliases'],
  source: ['tokens/**/*.json'],

  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'build/css/',
      files: [
        // Standard tokens (primitives, semantic color, border, etc.)
        {
          destination: 'variables.css',
          format: 'css/variables',
          filter: (token) => token.$type !== 'typography',
        },

        // Font composite tokens — responsive
        {
          destination: 'font.css',
          format: 'css/font-responsive',
          filter: (token) => token.$type === 'typography',
        },

        // Spacing tokens — responsive
        {
          destination: 'spacing.css',
          format: 'css/spacing-responsive',
        },
      ],
    },
  },
};
