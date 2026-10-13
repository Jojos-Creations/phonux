/**
 * Resolves the CSS the size glide writes (custom-property fallbacks, `calc`, `min`) to numbers, so a test can read what a browser
 * would draw without one. It handles only the lengths in px and the plain numbers those strings are made of.
 */

/** Substitutes `var(--name, fallback)` from `vars` (a name left out takes its fallback) and returns the text. */
export function substitute(value: string, vars: Record<string, number> = {}): string {
  return value.replace(/var\((--[\w-]+),\s*([^)]*)\)/g, (_, name: string, fallback: string) => String(vars[name] ?? fallback.trim()));
}

/** One length expression, in px, evaluated: `calc(24px / 0.5)` is 48. */
export function px(expression: string): number {
  const arithmetic = expression.replace(/calc\(/g, '(').replace(/min\(/g, 'Math.min(').replace(/(\d)px/g, '$1');
  if (!/^[\d\s.+\-*/(),eE]*(Math\.min)?[\d\s.+\-*/(),eE]*$/.test(arithmetic.replace(/Math\.min/g, ''))) throw new Error(`not arithmetic: ${expression}`);
  return (Function(`return (${arithmetic});`)() as number) + 0;
}

/** Splits a list on the commas outside parentheses. */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(value.slice(from).trim());
  return parts;
}

/** A `border-radius` of `a / b` resolved to its two radii in px. */
export function radii(value: string, vars: Record<string, number> = {}): [number, number] {
  const text = substitute(value, vars);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === '/' && depth === 0) return [px(text.slice(0, i)), px(text.slice(i + 1))];
  }
  throw new Error(`not a two-radius border-radius: ${value}`);
}

/** Each `inset` shadow of a `box-shadow` list as its x offset, y offset and spread in px (the colour is dropped). */
export function shadows(value: string, vars: Record<string, number> = {}): Array<{ x: number; y: number; spread: number }> {
  return splitList(substitute(value, vars)).map((layer) => {
    const lengths = layer.replace(/^inset\s+/, '').replace(/\s+(rgba?\(.*\)|#[\da-f]+|\w+)$/i, '');
    const tokens: string[] = [];
    let depth = 0;
    let token = '';
    for (const ch of lengths) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ' ' && depth === 0) {
        tokens.push(token);
        token = '';
      } else token += ch;
    }
    tokens.push(token);
    const [x = '0', y = '0', , spread = '0'] = tokens;
    return { x: px(x), y: px(y), spread: px(spread) };
  });
}
