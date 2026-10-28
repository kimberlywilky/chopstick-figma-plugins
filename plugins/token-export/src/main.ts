import { transformCollection } from './transformer';
import { mapCollectionToFiles, OutputFile } from './output';
import { readTextStyles } from './font';
import { readEffectStyles } from './effect';
import { buildMotionComposites } from './motion';

figma.showUI(__html__, { width: 400, height: 480 });

// ─── Style Type Detection ────────────────────────────────────────────────────

interface StyleTypeCheck {
  label: string;
  key: string;
  check: () => Promise<{ length: number }>;
}

const STYLE_TYPES: StyleTypeCheck[] = [
  { label: 'Text styles', key: 'text', check: () => figma.getLocalTextStylesAsync() },
  { label: 'Effect styles', key: 'effect', check: () => figma.getLocalEffectStylesAsync() },
  { label: 'Grid styles', key: 'grid', check: () => figma.getLocalGridStylesAsync() },
  { label: 'Paint styles', key: 'paint', check: () => figma.getLocalPaintStylesAsync() }
];

// ─── Send Available Collections and Style Types on Load ──────────────────────

(async () => {
  try {
    // Collections
    const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
    const collectionNames = allCollections
      .map(c => c.name)
      .filter(name => {
        // Exclude separator collections
        if (name === '---') return false;
        // Exclude assets collections (e.g. "Base assets", "Kiwi assets")
        const type = name.split(' ').slice(1).join(' ').toLowerCase();
        if (type === 'assets') return false;
        return true;
      })
      .sort((a, b) => {
        const aWords = a.split(' ');
        const bWords = b.split(' ');
        const secondWord = (aWords[1] ?? '').localeCompare(bWords[1] ?? '');
        if (secondWord !== 0) return secondWord;
        return (aWords[0] ?? '').localeCompare(bWords[0] ?? '');
      });

    // Style types (only include those with at least one style)
    const availableStyleTypes: { label: string; key: string }[] = [];
    for (const st of STYLE_TYPES) {
      const styles = await st.check();
      if (styles.length > 0) {
        availableStyleTypes.push({ label: st.label, key: st.key });
      }
    }

    figma.ui.postMessage({
      type: 'data-loaded',
      collections: collectionNames,
      styleTypes: availableStyleTypes
    });
  } catch (err: any) {
    figma.ui.postMessage({
      type: 'data-error',
      message: err.message
    });
  }
})();

// ─── Export Handler ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'start-export') return;

  const selectedNames: string[] = msg.selectedCollections;
  const selectedStyleTypes: string[] = msg.selectedStyleTypes;

  try {
    const allCollections = await figma.variables.getLocalVariableCollectionsAsync();

    const collections = allCollections.filter(c =>
      selectedNames.includes(c.name)
    );

    // Build a map of variableId → variable name for alias resolution.
    // Built from ALL collections (not just selected ones) so an alias in a
    // selected collection can still resolve if its target lives in an
    // unselected collection.
    const allVariables = new Map<string, string>();
    for (const collection of allCollections) {
      for (const id of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(id);
        if (variable) {
          allVariables.set(variable.id, variable.name);
        }
      }
    }

    // Transform each collection and map to output files
    const outputFiles: OutputFile[] = [];

    for (const collection of collections) {
      const variables = await Promise.all(
        collection.variableIds.map(id => figma.variables.getVariableByIdAsync(id))
      );

      const extCollection = collection as any;
      const isExtension = extCollection.isExtension === true;
      const variableOverrides = extCollection.variableOverrides ?? {};
      const collectionType = collection.name.split(' ').slice(1).join(' ').toLowerCase().replace(/\s*semantic$/, '');

      const modes = collection.modes.map(m => ({
        modeId: m.modeId,
        name: m.name,
        parentModeId: (m as any).parentModeId
      }));

      const variableList = variables
        .filter((v): v is Variable => v !== null)
        .map(v => ({
          id: v.id,
          name: v.name,
          type: v.resolvedType,
          description: v.description,
          valuesByMode: v.valuesByMode as Record<string, unknown>
        }));

      // Motion collections: assemble transition composites instead of
      // exporting individual timing/duration/delay variables
      if (collectionType === 'motion') {
        const motionOutput = buildMotionComposites(
          variableList,
          modes,
          isExtension,
          variableOverrides,
          allVariables
        );
        const files = mapCollectionToFiles(collection.name, motionOutput);
        outputFiles.push(...files);
        continue;
      }

      const transformed = transformCollection({
        collection: {
          name: collection.name,
          isExtension,
          variableOverrides,
          modes,
          variables: variableList
        },
        allVariables
      });

      const files = mapCollectionToFiles(collection.name, transformed);
      outputFiles.push(...files);
    }

    // ── Style Exports ────────────────────────────────────────────────────────

    // Text styles → typography composite tokens
    if (selectedStyleTypes.includes('text')) {
      const typographyStyles = await readTextStyles(allVariables);
      const typographyOutput: Record<string, unknown> = {};

      for (const { path, token } of typographyStyles) {
        let current = typographyOutput;
        for (let i = 0; i < path.length - 1; i++) {
          if (!(path[i] in current)) current[path[i]] = {};
          current = current[path[i]] as Record<string, unknown>;
        }
        current[path[path.length - 1]] = token;
      }

      if (Object.keys(typographyOutput).length > 0) {
        outputFiles.push({
          path: 'semantic/font/composite.json',
          content: typographyOutput
        });
      }
    }

    // Effect styles → shadow composite tokens
    if (selectedStyleTypes.includes('effect')) {
      const shadowStyles = await readEffectStyles(allVariables);

      // Group by first path segment so each effect group (shadow, glow, ...)
      // lands in its own composite file, mirroring the typography precedent.
      const groups: Record<string, Record<string, unknown>> = {};

      for (const { path, token } of shadowStyles) {
        const group = path[0];
        if (!(group in groups)) groups[group] = {};
        let current = groups[group];
        for (let i = 0; i < path.length - 1; i++) {
          if (!(path[i] in current)) current[path[i]] = {};
          current = current[path[i]] as Record<string, unknown>;
        }
        current[path[path.length - 1]] = token;
      }

      for (const group of Object.keys(groups)) {
        if (Object.keys(groups[group]).length > 0) {
          outputFiles.push({
            path: `semantic/${group}/composite.json`,
            content: groups[group]
          });
        }
      }
    }

    // TODO: Grid styles export
    // if (selectedStyleTypes.includes('grid')) { }

    // TODO: Paint styles export
    // if (selectedStyleTypes.includes('paint')) { }

    figma.ui.postMessage({
      type: 'export',
      files: outputFiles
    });

  } catch (err: any) {
    figma.ui.postMessage({
      type: 'export-error',
      message: err.message
    });
  }
};
