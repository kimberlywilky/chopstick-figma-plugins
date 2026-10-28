// ─── Typography Token Export ─────────────────────────────────────────────────
//
// The -figma suffix workaround strips a parallel px-based variable name
// (created solely so it can be bound to a text style property that can't
// accept percentage/unitless values) down to its real semantic token name.

export interface TypographyToken {
  $type: 'typography';
  $value: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
  };
  $description?: string;
}

export interface TypographyOutput {
  path: string[];
  token: TypographyToken;
}

export async function readTextStyles(
  allVariables: Map<string, string>
): Promise<TypographyOutput[]> {
  const styles = await figma.getLocalTextStylesAsync();
  const results: TypographyOutput[] = [];

  for (const style of styles) {
    // Skip styles with -figma suffix
    const nameParts = style.name.split('/');
    const lastName = nameParts[nameParts.length - 1];
    if (lastName.endsWith('-figma')) continue;

    // Skip styles marked as ignored
    if (style.description?.includes('[export-plugin-ignore]')) continue;

    const token = buildTypographyToken(style, allVariables);
    if (!token) continue;

    const path = nameParts.map(p => p.trim()).filter(Boolean);
    results.push({ path, token });
  }

  return results;
}

function buildTypographyToken(
  style: TextStyle,
  allVariables: Map<string, string>
): TypographyToken | null {
  const boundVars = style.boundVariables ?? {};

  const fontFamily = resolveProperty(
    boundVars.fontFamily,
    style.fontName.family,
    allVariables
  );

  const fontSize = resolveProperty(
    boundVars.fontSize,
    `${style.fontSize}px`,
    allVariables
  );

  const fontWeight = resolveProperty(
    boundVars.fontStyle ?? boundVars.fontWeight,
    style.fontName.style,
    allVariables
  );

  const lineHeight = resolveLineHeight(
    boundVars.lineHeight,
    style.lineHeight,
    allVariables
  );

  const letterSpacing = resolveLetterSpacing(
    boundVars.letterSpacing,
    style.letterSpacing,
    allVariables
  );

  return {
    $type: 'typography',
    $value: {
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing
    },
    $description: style.description || undefined
  };
}

// ─── Alias Name Cleaner ──────────────────────────────────────────────────────

// Figma text styles do not support percentage or unitless values for properties
// like lineHeight and letterSpacing. To work around this, Figma-specific tokens
// with a -figma suffix are created with px values so they can be bound to text
// styles. The actual semantic token (without -figma) is the correct reference
// for the exported composite. This function strips both the trailing * (brand
// book marker) and the -figma suffix so the alias points to the real token.
function cleanAliasName(name: string): string {
  return name
    .split('/')
    .map(s => {
      if (s.endsWith('*')) s = s.slice(0, -1);
      if (s.endsWith('-figma')) s = s.slice(0, -6);
      return s;
    })
    .join('.');
}

// ─── Property Resolvers ──────────────────────────────────────────────────────

function resolveProperty(
  boundVar: { type: 'VARIABLE_ALIAS'; id: string } | undefined,
  fallback: string,
  allVariables: Map<string, string>
): string {
  if (boundVar?.type === 'VARIABLE_ALIAS') {
    const name = allVariables.get(boundVar.id);
    if (name) return `{${cleanAliasName(name)}}`;
  }
  return fallback;
}

function resolveLineHeight(
  boundVar: { type: 'VARIABLE_ALIAS'; id: string } | undefined,
  lineHeight: LineHeight,
  allVariables: Map<string, string>
): string {
  if (boundVar?.type === 'VARIABLE_ALIAS') {
    const name = allVariables.get(boundVar.id);
    if (name) return `{${cleanAliasName(name)}}`;
  }
  if (lineHeight.unit === 'AUTO') return 'normal';
  if (lineHeight.unit === 'PERCENT') return `${lineHeight.value}%`;
  return `${lineHeight.value}px`;
}

function resolveLetterSpacing(
  boundVar: { type: 'VARIABLE_ALIAS'; id: string } | undefined,
  letterSpacing: LetterSpacing,
  allVariables: Map<string, string>
): string {
  if (boundVar?.type === 'VARIABLE_ALIAS') {
    const name = allVariables.get(boundVar.id);
    if (name) return `{${cleanAliasName(name)}}`;
  }
  if (letterSpacing.unit === 'PERCENT') return `${letterSpacing.value}%`;
  return `${letterSpacing.value}px`;
}
