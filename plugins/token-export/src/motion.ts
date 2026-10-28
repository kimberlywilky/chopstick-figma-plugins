// ─── Motion Composite Token Export ───────────────────────────────────────────
//
// Reads variables from motion collections and assembles sibling variables
// (timing, duration, delay) into DTCG transition composite tokens.
//
// Figma cannot store composite values in variables, so motion properties
// are defined as separate variables under a shared parent path:
//   motion/fade/timing    → alias {base.timing.ease-in-out}
//   motion/fade/duration  → alias {base.duration.normal}
//   motion/fade/delay     → alias {base.delay.none}       (optional)
//
// This module groups them by parent path and assembles each group into:
//   {
//     "$type": "transition",
//     "$value": {
//       "timingFunction": "{base.timing.ease-in-out}",
//       "duration": "{base.duration.normal}",
//       "delay": "{base.delay.none}"
//     }
//   }
//
// Only the composite is exported. Individual motion variables are not output.

import { resolveAlias, nameToPath } from './transformer';

// ─── Property Mapping ────────────────────────────────────────────────────────
//
// Maps the last segment of a Figma variable name to the DTCG transition
// property name. Variables whose last segment doesn't match are skipped.

const MOTION_PROPERTY_MAP: Record<string, string> = {
  'timing':   'timingFunction',
  'duration': 'duration',
  'delay':    'delay',
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransitionToken {
  $type: 'transition';
  $value: Record<string, string>;
}

export interface MotionOutput {
  path: string[];
  token: TransitionToken;
}

// ─── Motion Composite Builder ────────────────────────────────────────────────

export interface MotionVariable {
  id: string;
  name: string;
  type: string;
  description: string;
  valuesByMode: Record<string, unknown>;
}

export function buildMotionComposites(
  variables: MotionVariable[],
  modes: { modeId: string; name: string; parentModeId?: string }[],
  isExtension: boolean,
  variableOverrides: Record<string, Record<string, unknown>>,
  allVariables: Map<string, string>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  // Group variables by their parent path and collect properties
  // e.g. motion/fade/timing + motion/fade/duration → group "motion/fade"
  const groups = new Map<string, Map<string, MotionVariable>>();

  for (const variable of variables) {
    // Skip ignored and figma-only tokens
    if (variable.description?.includes('[export-plugin-ignore]')) continue;
    const lastName = variable.name.split('/').pop() ?? '';
    if (lastName.endsWith('-figma')) continue;

    // Check if the last segment is a known motion property
    const cleanLast = lastName.endsWith('*') ? lastName.slice(0, -1) : lastName;
    if (!(cleanLast in MOTION_PROPERTY_MAP)) continue;

    // Build the parent path key (everything except the last segment)
    const segments = variable.name.split('/').filter(Boolean);
    const parentKey = segments.slice(0, -1).join('/');

    if (!groups.has(parentKey)) groups.set(parentKey, new Map());
    groups.get(parentKey)!.set(cleanLast, variable);
  }

  // Assemble each group into a transition composite
  for (const [parentKey, properties] of groups) {
    // Must have at least timing + duration
    if (!properties.has('timing') || !properties.has('duration')) continue;

    const parentPath = nameToPath(parentKey);

    // For single-mode collections, output under 'default'
    if (modes.length === 1) {
      const mode = modes[0];
      const composite = assembleTransition(properties, mode.modeId, isExtension, variableOverrides, mode.parentModeId, allVariables);
      if (!composite) continue;

      if (!result['default']) result['default'] = {};
      setNestedComposite(result['default'], parentPath, composite);
      continue;
    }

    // For multi-mode collections, output per mode
    for (const mode of modes) {
      const modeName = mode.name.toLowerCase();
      const composite = assembleTransition(properties, mode.modeId, isExtension, variableOverrides, mode.parentModeId, allVariables);
      if (!composite) continue;

      if (!result[modeName]) result[modeName] = {};
      setNestedComposite(result[modeName], parentPath, composite);
    }
  }

  return result;
}

// ─── Transition Assembler ────────────────────────────────────────────────────

function assembleTransition(
  properties: Map<string, MotionVariable>,
  modeId: string,
  isExtension: boolean,
  variableOverrides: Record<string, Record<string, unknown>>,
  parentModeId: string | undefined,
  allVariables: Map<string, string>
): TransitionToken | null {
  const value: Record<string, string> = {};

  for (const [propName, variable] of properties) {
    const dtcgProp = MOTION_PROPERTY_MAP[propName];
    if (!dtcgProp) continue;

    const rawValue = getMotionRawValue(variable, modeId, isExtension, variableOverrides, parentModeId);

    // Motion semantics always use alias references
    if (rawValue && typeof rawValue === 'object' && 'type' in rawValue) {
      const alias = rawValue as { type: string; id: string };
      if (alias.type === 'VARIABLE_ALIAS') {
        const ref = resolveAlias(alias.id, allVariables);
        if (ref) value[dtcgProp] = ref;
      }
    }
  }

  // Must have at least timingFunction and duration
  if (!value['timingFunction'] || !value['duration']) return null;

  return {
    $type: 'transition',
    $value: value
  };
}

// ─── Raw Value Resolution (same logic as transformer.ts) ─────────────────────

function getMotionRawValue(
  variable: { id: string; valuesByMode: Record<string, unknown> },
  modeId: string,
  isExtension: boolean,
  variableOverrides: Record<string, Record<string, unknown>>,
  parentModeId?: string
): unknown {
  if (isExtension) {
    const overridesForVariable = variableOverrides[variable.id];
    if (overridesForVariable) {
      const overrideValue = overridesForVariable[modeId];
      if (overrideValue !== undefined) return overrideValue;
    }
  }

  if (parentModeId && variable.valuesByMode[parentModeId] !== undefined) {
    return variable.valuesByMode[parentModeId];
  }

  const simpleModeId = modeId.includes('/')
    ? modeId.split('/').pop()!
    : modeId;

  return variable.valuesByMode[simpleModeId] ?? variable.valuesByMode[modeId];
}

// ─── Nested Value Setter ─────────────────────────────────────────────────────

function setNestedComposite(
  obj: Record<string, unknown>,
  path: string[],
  value: TransitionToken
): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i] in current)) {
      current[path[i]] = {};
    }
    current = current[path[i]] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}
