// ─── Output File Mapping ─────────────────────────────────────────────────────
//
// Derives brand and type directly from the collection name, which follows a
// "{Brand} {Type}" naming convention (e.g. "Base color", "Kiwi spacing").

export interface OutputFile {
  path: string;
  content: Record<string, unknown>;
}

export function mapCollectionToFiles(
  collectionName: string,
  transformed: Record<string, Record<string, unknown>>
): OutputFile[] {
  const parts = collectionName.split(' ');
  const brand = parts[0].toLowerCase();
  // Strip "semantic" suffix from collection type since it's a classification
  // word, not a path segment (e.g. "color semantic" → "color")
  const type = parts.slice(1).join(' ').toLowerCase().replace(/\s*semantic$/, '');

  // Primitive collections: single file
  if (type === 'primitive') {
    const content = mergeResult(transformed);
    if (Object.keys(content).length === 0) return [];
    return [{ path: `primitive/${brand}.json`, content }];
  }

  // Numeric semantic collections: split by first-level token segment into
  // separate files. e.g. "Base numeric semantic" with tokens like
  // borderRadius/action/circle and font/action/label/fontFamily produces
  // semantic/borderRadius/base.json and semantic/font/base.json
  if (type === 'numeric') {
    return splitByFirstSegment(brand, transformed);
  }

  // All other semantic collections: single file
  const content = mergeResult(transformed);
  if (Object.keys(content).length === 0) return [];
  return [{ path: `semantic/${type.replace(/ /g, '-')}/${brand}.json`, content }];
}

// ─── Numeric Semantic Splitter ───────────────────────────────────────────────
//
// Splits a transformed collection into multiple files based on the first-level
// key of each token. Each first-level segment (borderRadius, font, spacing,
// layout, size, borderWidth, etc.) gets its own output file.
//
// The full token path is preserved including the first segment.

function splitByFirstSegment(
  brand: string,
  transformed: Record<string, Record<string, unknown>>
): OutputFile[] {
  const merged = mergeResult(transformed);
  if (Object.keys(merged).length === 0) return [];

  // Identify all first-level segments across all mode keys (or at root level)
  // The structure can be either:
  //   { desktop: { borderRadius: {...}, font: {...} }, tablet: {...}, mobile: {...} }
  //   or flat: { borderRadius: {...}, font: {...} }
  const modeKeys = Object.keys(merged);
  const firstMode = merged[modeKeys[0]];

  // Check if the top level is mode keys or token segments directly
  const isModed = typeof firstMode === 'object' && firstMode !== null && !('$type' in firstMode);

  if (isModed) {
    // Mode-prefixed structure: collect all first-level segments across modes
    const segments = new Set<string>();
    for (const mode of modeKeys) {
      const modeObj = merged[mode] as Record<string, unknown>;
      for (const key of Object.keys(modeObj)) {
        segments.add(key);
      }
    }

    const files: OutputFile[] = [];
    for (const segment of segments) {
      const segmentContent: Record<string, unknown> = {};
      for (const mode of modeKeys) {
        const modeObj = merged[mode] as Record<string, unknown>;
        if (modeObj[segment]) {
          segmentContent[mode] = { [segment]: modeObj[segment] };
        }
      }
      if (Object.keys(segmentContent).length > 0) {
        files.push({
          path: `semantic/${segment}/${brand}.json`,
          content: segmentContent
        });
      }
    }
    return files;
  }

  // Flat structure (no modes): split by first-level key directly
  const files: OutputFile[] = [];
  for (const segment of Object.keys(merged)) {
    files.push({
      path: `semantic/${segment}/${brand}.json`,
      content: { [segment]: merged[segment] }
    });
  }
  return files;
}

// ─── Result Merger ───────────────────────────────────────────────────────────

function mergeResult(
  transformed: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const defaultTokens = transformed['default'] ?? {};
  const modeKeys = Object.keys(transformed).filter(k => k !== 'default');

  // No mode keys — return default tokens as-is
  if (modeKeys.length === 0) {
    return defaultTokens;
  }

  // Has mode keys — merge default (static) tokens into each mode
  const result: Record<string, unknown> = {};

  for (const mode of modeKeys) {
    if (Object.keys(defaultTokens).length > 0) {
      result[mode] = deepMerge(defaultTokens, transformed[mode]);
    } else {
      result[mode] = transformed[mode];
    }
  }

  return result;
}

// ─── Deep Merge ──────────────────────────────────────────────────────────────

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !('$value' in (override[key] as object)) &&
      typeof base[key] === 'object' &&
      base[key] !== null
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        override[key] as Record<string, unknown>
      );
    } else {
      result[key] = override[key];
    }
  }
  return result;
}
