// ─── Effect (Shadow) Token Export ────────────────────────────────────────────
//
// Reads local effect styles and emits DTCG shadow composite tokens. Mirrors the
// typography handler in font.ts: each property is resolved through the same
// bound-or-literal rule, where a variable-bound property becomes a {alias}
// reference and an unbound property becomes its literal value.
//
// Only DROP_SHADOW and INNER_SHADOW effects are exported. Other effect kinds
// (layer blur, background blur, noise, texture) have no DTCG shadow equivalent
// and are skipped. A style holding a single shadow emits a shadow object; a
// style stacking multiple shadows emits an array of shadow objects in Figma
// effect order.

import { resolveAlias, nameToPath, colorToValue } from './transformer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShadowValue {
  color: string;
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
  inset: boolean;
}

export interface ShadowToken {
  $type: 'shadow';
  $value: ShadowValue | ShadowValue[];
  $description?: string;
}

export interface ShadowOutput {
  path: string[];
  token: ShadowToken;
}

type ShadowEffect = DropShadowEffect | InnerShadowEffect;

// ─── Reader ────────────────────────────────────────────────────────────────────

export async function readEffectStyles(
  allVariables: Map<string, string>
): Promise<ShadowOutput[]> {
  const styles = await figma.getLocalEffectStylesAsync();
  const results: ShadowOutput[] = [];

  for (const style of styles) {
    // Skip styles with -figma suffix on their final segment
    const nameParts = style.name.split('/');
    const lastName = nameParts[nameParts.length - 1];
    if (lastName.endsWith('-figma')) continue;

    // Skip styles marked as ignored
    if (style.description?.includes('[export-plugin-ignore]')) continue;

    // Keep only visible shadow effects; other effect kinds have no shadow analog
    const shadowEffects = style.effects
      .filter(isShadowEffect)
      .filter(effect => effect.visible !== false);

    if (shadowEffects.length === 0) continue;

    const values = shadowEffects.map(effect => buildShadowValue(effect, allVariables));

    const token: ShadowToken = {
      $type: 'shadow',
      $value: values.length === 1 ? values[0] : values,
      $description: style.description || undefined
    };

    results.push({ path: nameToPath(style.name), token });
  }

  return results;
}

// ─── Effect Type Guard ──────────────────────────────────────────────────────

function isShadowEffect(effect: Effect): effect is ShadowEffect {
  return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW';
}

// ─── Shadow Value Builder ─────────────────────────────────────────────────────

function buildShadowValue(
  effect: ShadowEffect,
  allVariables: Map<string, string>
): ShadowValue {
  const bound = effect.boundVariables ?? {};

  return {
    color: resolveColor(bound.color, effect.color, allVariables),
    offsetX: resolveDimension(bound.offsetX, effect.offset.x, allVariables),
    offsetY: resolveDimension(bound.offsetY, effect.offset.y, allVariables),
    blur: resolveDimension(bound.radius, effect.radius, allVariables),
    spread: resolveDimension(bound.spread, effect.spread ?? 0, allVariables),
    inset: effect.type === 'INNER_SHADOW'
  };
}

// ─── Property Resolvers ──────────────────────────────────────────────────────
//
// Each resolver follows the font.ts rule: a variable-bound property resolves to
// a {alias} reference, an unbound property falls back to its literal value. A
// bound dimension carries its unit through the referenced token, so no unit is
// appended; an unbound dimension is a raw Figma px number and gets px appended.

function resolveColor(
  boundVar: VariableAlias | undefined,
  fallback: RGBA,
  allVariables: Map<string, string>
): string {
  if (boundVar?.type === 'VARIABLE_ALIAS') {
    const ref = resolveAlias(boundVar.id, allVariables);
    if (ref) return ref;
  }
  return colorToValue(fallback);
}

function resolveDimension(
  boundVar: VariableAlias | undefined,
  fallback: number,
  allVariables: Map<string, string>
): string {
  if (boundVar?.type === 'VARIABLE_ALIAS') {
    const ref = resolveAlias(boundVar.id, allVariables);
    if (ref) return ref;
  }
  return `${fallback}px`;
}
