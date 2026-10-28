// ─── Color Utilities ────────────────────────────────────────────────────────

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): string {
  const r1 = r, g1 = g, b1 = b;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r1: h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6; break;
      case g1: h = ((b1 - r1) / d + 2) / 6; break;
      case b1: h = ((r1 - g1) / d + 4) / 6; break;
    }
  }

  const hDeg = Math.round(h * 360);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);

  return `hsl(${hDeg}, ${sPct}%, ${lPct}%)`;
}

export function roundAlpha(alpha: number): number {
  return Math.round(alpha * 100) / 100;
}

export function colorToValue(color: RGBA): string {
  const { r, g, b, a } = color;
  const alpha = roundAlpha(a);
  if (alpha === 1) {
    return rgbToHex(r, g, b);
  }
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

export function colorToHsl(color: RGBA): string {
  const { r, g, b, a } = color;
  const alpha = roundAlpha(a);
  const hsl = rgbToHsl(r, g, b);
  if (alpha === 1) return hsl;
  return hsl.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// ─── Alias Resolution ───────────────────────────────────────────────────────

export function resolveAlias(variableId: string, allVariables: Map<string, string>): string {
  const name = allVariables.get(variableId);
  if (!name) return '';
  // Strip trailing * from each path segment before converting to dot notation
  const cleanName = name
    .split('/')
    .map(segment => segment.endsWith('*') ? segment.slice(0, -1) : segment)
    .join('/');
  return `{${cleanName.replace(/\//g, '.')}}`;
}

// ─── Token Path ─────────────────────────────────────────────────────────────

export function nameToPath(name: string): string[] {
  return name
    .split('/')
    .filter(Boolean)
    .map(segment => segment.endsWith('*') ? segment.slice(0, -1) : segment);
}

export function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i] in current)) {
      current[path[i]] = {};
    }
    current = current[path[i]] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

// ─── Description Cleaner ─────────────────────────────────────────────────────

function cleanDescription(description: string): string | undefined {
  const cleaned = description
    .replace('[export-plugin-ignore]', '')
    .trim();
  return cleaned || undefined;
}

// ─── DTCG Type Map ──────────────────────────────────────────────────────────
//
// Maps token path segments to their correct DTCG type and optional unit.
// When a token's path contains a matching segment, the DTCG type and unit
// override the default Figma-to-DTCG mapping. Segments are matched from
// deepest to shallowest, so the most specific match wins.
//
// A new FLOAT-based category not listed here (or named differently) will
// silently fall through to the default number/string mapping instead of the
// correct DTCG type. See "Extending the Plugin" in README.md.

const DTCG_TYPE_MAP: Record<string, { type: string; unit?: string; parse?: string }> = {
  // Font
  'fontFamily':     { type: 'fontFamily' },
  'fontWeight':     { type: 'fontWeight' },
  'fontSize':       { type: 'dimension', unit: 'px' },
  'letterSpacing':  { type: 'dimension', unit: 'em', parse: 'percentToDecimal' },
  'lineHeight':     { type: 'number', parse: 'percentToDecimal' },

  // Spacing & layout
  'spacing':        { type: 'dimension', unit: 'px' },
  'gutter':         { type: 'dimension', unit: 'px' },
  'margin':         { type: 'dimension', unit: 'px' },

  // Border
  'borderWidth':    { type: 'dimension', unit: 'px' },
  'borderRadius':   { type: 'dimension', unit: 'px' },

  // Sizing
  'size':           { type: 'dimension', unit: 'px' },

  // Effects
  'blur':           { type: 'dimension', unit: 'px' },

  // Motion primitives
  'duration':       { type: 'duration', unit: 'ms' },
  'delay':          { type: 'duration', unit: 'ms' },
};

function resolveDTCGType(path: string[]): { type: string; unit?: string; parse?: string } | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const mapping = DTCG_TYPE_MAP[path[i]];
    if (mapping) return mapping;
  }
  return null;
}

// ─── cubicBezier Parser ─────────────────────────────────────────────────────
//
// Parses a comma-separated string of 4 numbers into a cubicBezier array.
// e.g. "0.42, 0, 0.58, 1" → [0.42, 0, 0.58, 1]

function parseCubicBezier(value: string): number[] | null {
  const parts = value.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 4 && parts.every(n => !isNaN(n))) {
    return parts;
  }
  return null;
}

// ─── Percent to Decimal ─────────────────────────────────────────────────────
//
// Converts Figma percentage values to their decimal equivalents.
// Figma stores lineHeight as 150 (meaning 150%) and letterSpacing as 1.5
// (meaning 1.5%). Both need to be divided by 100 for their code output:
//   lineHeight:    150 → 1.5 (unitless ratio)
//   letterSpacing: 1.5 → 0.015 (then appended with unit, e.g. "0.015em")

function percentToDecimal(value: number): number {
  return value / 100;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DTCGToken {
  $type: string;
  $value: string | number | number[];
  $description?: string;
}

export interface TransformOptions {
  collection: {
    name: string;
    isExtension?: boolean;
    variableOverrides?: Record<string, Record<string, unknown>>;
    modes: { modeId: string; name: string; parentModeId?: string }[];
    variables: {
      id: string;
      name: string;
      type: string;
      description: string;
      valuesByMode: Record<string, unknown>;
    }[];
  };
  allVariables: Map<string, string>;
}

// ─── Main Transformer ───────────────────────────────────────────────────────

export function transformCollection(options: TransformOptions): Record<string, Record<string, unknown>> {
  const { collection, allVariables } = options;
  const { isExtension = false, variableOverrides = {} } = collection;
  const result: Record<string, Record<string, unknown>> = {};

  for (const variable of collection.variables) {
    // [export-plugin-ignore] always wins -- skip immediately regardless of other tags
    if (variable.description?.includes('[export-plugin-ignore]')) continue;

    // Skip tokens meant for Figma only
    const lastName = variable.name.split('/').pop() ?? '';
    if (lastName.endsWith('-figma')) continue;

    const path = nameToPath(variable.name);
    const modes = collection.modes;

    // Single mode collections (Null mode or single mode primitives)
    if (modes.length === 1) {
      const mode = modes[0];
      const rawValue = getRawValue(variable, mode.modeId, isExtension, variableOverrides, mode.parentModeId);
      const token = buildToken(variable.type, rawValue, variable.description, allVariables, path);
      if (!token) continue;

      if (!result['default']) result['default'] = {};
      setNestedValue(result['default'], path, token);
      continue;
    }

    // Multi-mode collections
    for (const mode of modes) {
      const modeName = mode.name.toLowerCase();
      const rawValue = getRawValue(variable, mode.modeId, isExtension, variableOverrides, mode.parentModeId);
      const token = buildToken(variable.type, rawValue, variable.description, allVariables, path);
      if (!token) continue;

      if (!result[modeName]) result[modeName] = {};
      setNestedValue(result[modeName], path, token);
    }
  }

  return result;
}

// ─── Raw Value Resolution ────────────────────────────────────────────────────

function getRawValue(
  variable: { id: string; valuesByMode: Record<string, unknown> },
  modeId: string,
  isExtension: boolean,
  variableOverrides: Record<string, Record<string, unknown>>,
  parentModeId?: string
): unknown {
  // For extended collections, check variableOverrides first
  if (isExtension) {
    const overridesForVariable = variableOverrides[variable.id];
    if (overridesForVariable) {
      const overrideValue = overridesForVariable[modeId];
      if (overrideValue !== undefined) return overrideValue;
    }
  }

  // Use parentModeId if available -- this is the actual key in valuesByMode
  if (parentModeId && variable.valuesByMode[parentModeId] !== undefined) {
    return variable.valuesByMode[parentModeId];
  }

  // Fall back to simple modeId extraction
  const simpleModeId = modeId.includes('/')
    ? modeId.split('/').pop()!
    : modeId;

  return variable.valuesByMode[simpleModeId] ?? variable.valuesByMode[modeId];
}

// ─── Token Builder ──────────────────────────────────────────────────────────

function buildToken(
  type: string,
  rawValue: unknown,
  description: string,
  allVariables: Map<string, string>,
  path: string[]
): DTCGToken | null {
  // Alias token -- resolve the reference and apply DTCG type if mapped
  if (rawValue && typeof rawValue === 'object' && 'type' in rawValue) {
    const alias = rawValue as { type: string; id: string };
    if (alias.type === 'VARIABLE_ALIAS') {
      const ref = resolveAlias(alias.id, allVariables);
      if (!ref) return null;
      const mapping = resolveDTCGType(path);
      return {
        $type: mapping?.type ?? figmaTypeToDTCG(type),
        $value: ref,
        $description: cleanDescription(description)
      };
    }
  }

  // Color token -- already DTCG-correct, no mapping needed
  if (type === 'COLOR' && rawValue && typeof rawValue === 'object') {
    const color = rawValue as RGBA;
    return {
      $type: 'color',
      $value: colorToValue(color),
      $description: colorToHsl(color)
    };
  }

  // Timing variable (Figma native motion) -- stored in seconds, output in ms.
  // Figma displays "50ms" but stores 0.05, with floating-point noise, so
  // convert to ms and round to whole milliseconds.
  if (type === 'TIMING') {
    if (typeof rawValue !== 'number') return null;
    const ms = Math.round(rawValue * 1000);
    return {
      $type: 'duration',
      $value: `${ms}ms`,
      $description: cleanDescription(description)
    };
  }

  // Easing variable (Figma native motion) -- cubic bezier maps to the DTCG
  // cubicBezier array [p1x, p1y, p2x, p2y]. Springs have no DTCG equivalent,
  // so an easing without bezier values is skipped with a warning.
  if (type === 'EASING') {
    const easing = rawValue as {
      bezierValues?: { p1x: number; p1y: number; p2x: number; p2y: number };
    } | null;
    const bezier = easing?.bezierValues;
    if (!bezier) {
      console.warn(
        `[token-export] Skipping easing token without bezier values (springs are not supported in DTCG): ${path.join('/')}`
      );
      return null;
    }
    return {
      $type: 'cubicBezier',
      $value: [bezier.p1x, bezier.p1y, bezier.p2x, bezier.p2y],
      $description: cleanDescription(description)
    };
  }

  // Check DTCG type map for non-color tokens
  const mapping = resolveDTCGType(path);

  if (mapping) {
    // cubicBezier: parse "0.42, 0, 0.58, 1" into [0.42, 0, 0.58, 1]
    if (mapping.parse === 'cubicBezier' && type === 'STRING') {
      const parsed = parseCubicBezier(rawValue as string);
      if (!parsed) return null;
      return {
        $type: mapping.type,
        $value: parsed,
        $description: cleanDescription(description)
      };
    }

    // FLOAT with percent-to-decimal conversion
    // e.g. lineHeight 150 -> 1.5, letterSpacing 1.5 -> "0.015em"
    if (mapping.parse === 'percentToDecimal' && type === 'FLOAT') {
      const converted = percentToDecimal(rawValue as number);
      return {
        $type: mapping.type,
        $value: mapping.unit ? `${converted}${mapping.unit}` : converted,
        $description: cleanDescription(description)
      };
    }

    // FLOAT with unit: append unit (e.g. 16 -> "16px", 200 -> "200ms")
    if (type === 'FLOAT') {
      return {
        $type: mapping.type,
        $value: mapping.unit ? `${rawValue}${mapping.unit}` : rawValue as number,
        $description: cleanDescription(description)
      };
    }

    // fontWeight: derive the numeric weight from the variable's own name
    // (last path segment) rather than the Figma-stored word value, since
    // word-to-number is not consistent across font families.
    // e.g. base/fontWeight/main/400 (value: "regular") -> $value: 400
    //
    // fontWeight tokens are expected to have a numeric last path segment; if
    // not, this branch warns and skips the token.
    if (mapping.type === 'fontWeight' && type === 'STRING') {
      const lastSegment = path[path.length - 1];
      const weight = parseInt(lastSegment, 10);
      if (isNaN(weight)) {
        console.warn(
          `[token-export] Skipping fontWeight token without a numeric name segment: ${path.join('/')}`
        );
        return null;
      }
      return {
        $type: 'fontWeight',
        $value: weight,
        $description: cleanDescription(description)
      };
    }

    // STRING with mapping but no parse: keep value as-is, apply mapped type
    if (type === 'STRING') {
      return {
        $type: mapping.type,
        $value: rawValue as string,
        $description: cleanDescription(description)
      };
    }
  }

  // No mapping -- fall back to default Figma-to-DTCG behavior
  if (type === 'FLOAT') {
    return {
      $type: 'number',
      $value: rawValue as number,
      $description: cleanDescription(description)
    };
  }

  if (type === 'STRING') {
    return {
      $type: 'string',
      $value: rawValue as string,
      $description: cleanDescription(description)
    };
  }

  return null;
}

// ─── Type Mapping ────────────────────────────────────────────────────────────

function figmaTypeToDTCG(type: string): string {
  switch (type) {
    case 'COLOR': return 'color';
    case 'FLOAT': return 'number';
    case 'STRING': return 'string';
    case 'BOOLEAN': return 'boolean';
    case 'TIMING': return 'duration';
    case 'EASING': return 'cubicBezier';
    default: return type.toLowerCase();
  }
}
