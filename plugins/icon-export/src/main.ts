// ─── Icon Discovery ──────────────────────────────────────────────────────────

interface IconVariant {
  nodeId: string;
  brand: string;
}

interface IconEntry {
  name: string;
  variants: IconVariant[];
}

const ICON_PREFIX = 'icon/';

/**
 * Extracts the brand value from a Figma variant name, which follows the
 * standard Figma "property=value" variant-naming format (e.g.
 * "don't use (brand)=Base"). Only the text after the LAST "=" is used as
 * the brand value -- the property name itself is never read or validated.
 *
 * Falls back to the full trimmed name if there is no "=" at all.
 */
function parseBrandFromVariantName(name: string): string {
  const lastEquals = name.lastIndexOf('=');
  if (lastEquals === -1) return name.trim();
  return name.slice(lastEquals + 1).trim();
}

/**
 * Converts Figma's snake_case icon names to camelCase for output filenames.
 * e.g. "add_circle" -> "addCircle"
 */
function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Recursively walks a list of nodes, matching COMPONENT_SET nodes named
 * "icon/<name>". Each COMPONENT child of a matching set is treated as one
 * brand variant of that icon. Non-matching nodes are recursed into if they
 * have children, so icon sets can live nested inside frames or groups.
 */
function findIconComponents(nodes: readonly SceneNode[]): IconEntry[] {
  const icons: IconEntry[] = [];

  for (const node of nodes) {
    if (node.type === 'COMPONENT_SET' && node.name.startsWith(ICON_PREFIX)) {
      const name = node.name.slice(ICON_PREFIX.length);
      const variants: IconVariant[] = node.children
        .filter((child): child is ComponentNode => child.type === 'COMPONENT')
        .map((child) => ({
          nodeId: child.id,
          brand: parseBrandFromVariantName(child.name)
        }));
      icons.push({ name, variants });
      continue;
    }

    if ('children' in node && node.children) {
      icons.push(...findIconComponents(node.children));
    }
  }

  return icons.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Scan Result Shaping ──────────────────────────────────────────────────────

interface ScanResultIcon {
  name: string;
  brands: string[];
}

interface ScanResult {
  icons: ScanResultIcon[];
  brands: string[];
}

function buildScanResult(icons: IconEntry[]): ScanResult {
  const brandSet = new Set<string>();

  const resultIcons: ScanResultIcon[] = icons.map((icon) => {
    const brands = icon.variants.map((v) => v.brand);
    brands.forEach((b) => brandSet.add(b));
    return { name: icon.name, brands };
  });

  return {
    icons: resultIcons,
    brands: Array.from(brandSet).sort()
  };
}

// ─── Module State ────────────────────────────────────────────────────────────
//
// The UI only ever round-trips icon names and brand strings, never node IDs,
// so this module-level list is what handleExport() looks up against when the
// user triggers an export.

let currentIcons: IconEntry[] = [];

// ─── Thumbnails ──────────────────────────────────────────────────────────────

/**
 * Exports a 4x-scale PNG thumbnail for every icon/brand combination, for
 * UI preview only -- has no bearing on the final SVG export. Streams each
 * thumbnail to the UI individually as it finishes rather than batching, and
 * is wrapped per-variant so one failed render doesn't stop the rest. A
 * failed render simply leaves that variant's placeholder in place; it never
 * blocks that variant's actual SVG export later.
 */
async function generateThumbnails(icons: IconEntry[]): Promise<void> {
  for (const icon of icons) {
    for (const variant of icon.variants) {
      try {
        const node = await figma.getNodeByIdAsync(variant.nodeId);
        if (!node || !('exportAsync' in node)) continue;

        const bytes = await (node as ComponentNode).exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: 4 }
        });

        figma.ui.postMessage({
          type: 'thumbnail',
          name: icon.name,
          brand: variant.brand,
          data: bytes
        });
      } catch (err) {
        continue;
      }
    }
  }
}

// ─── SVG Cleanup ─────────────────────────────────────────────────────────────

/**
 * Fixed sequence of string/regex cleanup passes applied to the raw SVG text
 * returned by exportAsync(). Order matters: step 7 checks for remaining
 * xlink: usage AFTER ids/data attributes have already been stripped, not
 * before -- reordering these steps can change the result.
 *
 * This does not touch width/height attributes, does not normalize or
 * rewrite viewBox, does not inject currentColor or otherwise alter
 * fill/stroke values, and does not run any dedicated SVG optimizer. Icon
 * dimensions and colors ship exactly as authored in the Figma component,
 * byte-for-byte aside from the steps below.
 */
function cleanSvg(raw: string): string {
  let svg = raw;

  // 1. Remove the XML declaration
  svg = svg.replace(/<\?xml[^>]*\?>\s*/i, '');

  // 2. Remove HTML/XML comments
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Remove empty <g></g> groups. Repeat until stable, since removing one
  //    empty group can expose another that was only non-empty because of
  //    the group just removed.
  let previous: string;
  do {
    previous = svg;
    svg = svg.replace(/<g(?:\s[^>]*)?>\s*<\/g>/g, '');
  } while (svg !== previous);

  // 4. Remove all id="..." attributes (Figma-internal, not meaningful downstream)
  svg = svg.replace(/\s+id="[^"]*"/g, '');

  // 5. Remove all data-* attributes
  svg = svg.replace(/\s+data-[a-zA-Z0-9-]+="[^"]*"/g, '');

  // 6. Remove empty <defs></defs> blocks
  do {
    previous = svg;
    svg = svg.replace(/<defs(?:\s[^>]*)?>\s*<\/defs>/g, '');
  } while (svg !== previous);

  // 7. Remove the xmlns:xlink namespace declaration, but only if no
  //    xlink: reference remains anywhere in the SVG at this point
  if (!svg.includes('xlink:')) {
    svg = svg.replace(/\s+xmlns:xlink="[^"]*"/g, '');
  }

  // 8. Collapse 3+ consecutive blank lines to one, then trim
  svg = svg.replace(/\n{3,}/g, '\n\n').trim();

  return svg;
}

// ─── Export ──────────────────────────────────────────────────────────────────

async function exportIconVariant(nodeId: string): Promise<string> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || !('exportAsync' in node)) {
    throw new Error(`Node not found or not exportable: ${nodeId}`);
  }

  const bytes = await (node as ComponentNode).exportAsync({ format: 'SVG' });
  const raw = new TextDecoder().decode(bytes);
  return cleanSvg(raw);
}

// ─── Scan Entry Points ────────────────────────────────────────────────────────

async function scanPage(): Promise<void> {
  currentIcons = findIconComponents(figma.currentPage.children);
  const result = buildScanResult(currentIcons);

  figma.ui.postMessage({ type: 'scan-result', ...result, emptySelection: false });

  generateThumbnails(currentIcons);
}

async function scanSelection(): Promise<void> {
  const selection = figma.currentPage.selection;

  // An empty selection is an explicit empty result, not an error, so the UI
  // can tell "nothing selected" apart from "selection has no icons."
  if (selection.length === 0) {
    currentIcons = [];
    figma.ui.postMessage({ type: 'scan-result', icons: [], brands: [], emptySelection: true });
    return;
  }

  currentIcons = findIconComponents(selection);
  const result = buildScanResult(currentIcons);

  figma.ui.postMessage({ type: 'scan-result', ...result, emptySelection: false });

  generateThumbnails(currentIcons);
}

// ─── Handle Export ────────────────────────────────────────────────────────────

interface ExportSelection {
  name: string;
  brands: string[];
}

interface OutputFile {
  path: string;
  content: string;
}

async function handleExport(selections: ExportSelection[]): Promise<void> {
  const files: OutputFile[] = [];

  for (const selection of selections) {
    const icon = currentIcons.find((i) => i.name === selection.name);
    if (!icon) continue;

    for (const brand of selection.brands) {
      const variant = icon.variants.find((v) => v.brand === brand);
      if (!variant) continue;

      const content = await exportIconVariant(variant.nodeId);
      const path = `${brand.toLowerCase()}/${toCamelCase(icon.name)}.svg`;
      files.push({ path, content });

      figma.ui.postMessage({
        type: 'export-progress',
        name: icon.name,
        brand,
        completed: files.length
      });
    }
  }

  figma.ui.postMessage({ type: 'export-complete', files });
}

// ─── Plugin Entry Point ───────────────────────────────────────────────────────

figma.showUI(__html__, { width: 400, height: 480 });

// Runs automatically on load so the icon list populates without the user
// needing to click anything first.
scanPage();

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'scan-page') {
      await scanPage();
    } else if (msg.type === 'scan-selection') {
      await scanSelection();
    } else if (msg.type === 'start-export') {
      await handleExport(msg.selections);
    }
  } catch (err: any) {
    const errorType = msg.type === 'start-export' ? 'export-error' : 'scan-error';
    figma.ui.postMessage({ type: errorType, message: err.message });
  }
};
