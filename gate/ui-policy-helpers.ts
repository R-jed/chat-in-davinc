export interface CssDeclaration {
  property: string;
  value: string;
}

export interface CssRule {
  selector: string;
  declarations: CssDeclaration[];
  atRules: string[];
}

export interface HtmlTag {
  name: string;
  attributes: Map<string, string>;
  raw: string;
  start: number;
  end: number;
}

export interface DynamicControl {
  variable: string;
  tag: 'button' | 'input';
  type: string | null;
  id: string | null;
  ariaLabel: boolean;
  ariaLabelledBy: boolean;
  visibleText: boolean;
  innerHtml: string[];
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCssValue(value: string): string {
  return normalizeWhitespace(value);
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(source: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parens = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') parens += 1;
    else if (char === ')' || char === ']') parens = Math.max(0, parens - 1);
    else if (char === delimiter && parens === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function declarationColon(source: string): number {
  let parens = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') parens += 1;
    else if (char === ')' || char === ']') parens = Math.max(0, parens - 1);
    else if (char === ':' && parens === 0) return index;
  }
  return -1;
}

function parseDeclarations(body: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  for (const raw of splitTopLevel(body, ';')) {
    const colon = declarationColon(raw);
    if (colon < 0) continue;
    const property = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    if (property && value) declarations.push({ property, value });
  }
  return declarations;
}

function withoutNestedBlocks(body: string): string {
  let result = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quote) {
      if (depth === 0) result += char;
      if (char === '\\') {
        if (depth === 0 && index + 1 < body.length) result += body[index + 1]!;
        index += 1;
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      if (depth === 0) result += char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) result += char;
  }
  return result;
}

export function parseCss(source: string): CssRule[] {
  const clean = stripCssComments(source);
  const rules: CssRule[] = [];

  function walk(segment: string, atRules: string[]): void {
    let cursor = 0;
    while (cursor < segment.length) {
      while (cursor < segment.length && /[\s;]/.test(segment[cursor]!)) cursor += 1;
      if (cursor >= segment.length) break;
      const open = segment.indexOf('{', cursor);
      const semicolon = segment.indexOf(';', cursor);
      if (open < 0 || (semicolon >= 0 && semicolon < open)) {
        cursor = semicolon >= 0 ? semicolon + 1 : segment.length;
        continue;
      }
      const prelude = normalizeWhitespace(segment.slice(cursor, open));
      const close = matchingBrace(segment, open);
      if (close < 0) throw new Error(`Unbalanced CSS block near: ${prelude}`);
      const body = segment.slice(open + 1, close);
      if (prelude.startsWith('@')) walk(body, [...atRules, prelude]);
      else if (prelude) {
        rules.push({ selector: prelude, declarations: parseDeclarations(withoutNestedBlocks(body)), atRules });
        if (body.includes('{')) walk(body, atRules);
      }
      cursor = close + 1;
    }
  }

  walk(clean, []);
  return rules;
}

export function declarationValues(rules: CssRule[], selector: string, property: string): string[] {
  return rules
    .filter((rule) => rule.selector === selector)
    .flatMap((rule) => rule.declarations.filter((declaration) => declaration.property === property).map((declaration) => normalizeCssValue(declaration.value)));
}

export function rootCustomProperties(rules: CssRule[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const rule of rules) {
    if (rule.selector !== ':root' || rule.atRules.length > 0) continue;
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith('--')) values.set(declaration.property, declaration.value);
    }
  }
  return values;
}

export function customPropertiesForRule(rule: CssRule, rootValues: Map<string, string>, allRules: CssRule[] = []): Map<string, string> {
  const values = new Map(rootValues);
  const conditionalRootNames = new Set<string>();
  for (const candidate of allRules) {
    if (candidate.selector !== ':root' || candidate.atRules.length === 0) continue;
    for (const declaration of candidate.declarations) {
      if (declaration.property.startsWith('--')) conditionalRootNames.add(declaration.property);
    }
  }
  // A conditional root variable can override an otherwise unconditional rule at runtime.
  // The source-level gate deliberately fails closed instead of trying to prove media/supports overlap.
  for (const name of conditionalRootNames) values.set(name, `var(${name})`);
  for (const declaration of rule.declarations) {
    if (declaration.property.startsWith('--')) values.set(declaration.property, declaration.value);
  }
  return values;
}

export function resolveCssVars(value: string, variables: Map<string, string>): { value: string; unresolved: string[] } {
  let resolved = value;
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    resolved = resolved.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (whole, name: string, fallback: string | undefined) => {
      const replacement = variables.get(name) ?? fallback;
      if (replacement === undefined) return whole;
      changed = true;
      return replacement.trim();
    });
    if (!changed) break;
  }
  const unresolved = [...resolved.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!).filter((name, index, all) => all.indexOf(name) === index);
  return { value: resolved, unresolved };
}

export function motionDurationAudit(property: string, rawValue: string, variables: Map<string, string>): { durationsMs: number[]; unsupported: string[] } | null {
  if (!['transition', 'transition-duration', 'animation', 'animation-duration'].includes(property)) return null;
  const resolved = resolveCssVars(rawValue, variables);
  const durationsMs = [...resolved.value.matchAll(/(?<![\w.-])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(ms|s)\b/gi)].map((match) => {
    const numeric = Number(match[1]);
    return match[2]!.toLowerCase() === 's' ? numeric * 1000 : numeric;
  });
  const unsupported = [...resolved.unresolved];
  if (/\b(?:calc|min|max|clamp)\(/.test(resolved.value)) unsupported.push('computed-duration');
  return { durationsMs, unsupported };
}

function fontTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let parens = 0;
  for (const char of value) {
    if (/\s/.test(char) && parens === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
    if (char === '(') parens += 1;
    else if (char === ')') parens = Math.max(0, parens - 1);
  }
  if (current) tokens.push(current);
  return tokens;
}

function looksLikeFontSize(token: string): boolean {
  return /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|\d*\.?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|%))(?:\/.*)?$/i.test(token);
}

function weightFromToken(token: string): number | null {
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
    const weight = Number(token);
    return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : null;
  }
  if (token === 'normal') return 400;
  if (token === 'bold' || token === 'bolder') return 700;
  if (token === 'lighter') return 100;
  return null;
}

export function fontWeightAudit(property: string, rawValue: string, variables: Map<string, string>): { weights: number[]; unsupported: string[] } | null {
  if (property !== 'font-weight' && property !== 'font') return null;
  const resolved = resolveCssVars(rawValue, variables);
  const normalized = normalizeWhitespace(resolved.value);
  if (['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(normalized)) return { weights: [400], unsupported: [] };
  if (property === 'font-weight') {
    const weight = weightFromToken(normalized);
    const unsupported = [...resolved.unresolved];
    if (weight === null) unsupported.push(`font-weight:${normalized}`);
    return { weights: weight === null ? [] : [weight], unsupported };
  }

  const tokens = fontTokens(normalized);
  const sizeIndex = tokens.findIndex(looksLikeFontSize);
  if (sizeIndex < 0) return { weights: [], unsupported: ['font-shorthand-size'] };
  const prefix = tokens.slice(0, sizeIndex);
  if (prefix.some((token) => token.includes('var('))) return { weights: [], unsupported: ['font-shorthand-var'] };
  const explicit: number[] = [];
  const unsupported: string[] = [];
  for (const token of prefix) {
    const weight = weightFromToken(token);
    if (weight !== null) explicit.push(weight);
    else if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) unsupported.push(`font-weight:${token}`);
  }
  return { weights: explicit.length > 0 ? explicit : [400], unsupported };
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  return attributes;
}

export function htmlOpeningTags(source: string, tagName: string): HtmlTag[] {
  const tags: HtmlTag[] = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    tags.push({ name: tagName.toLowerCase(), attributes: parseAttributes(match[1] ?? ''), raw: match[0], start, end: start + match[0].length });
  }
  return tags;
}

export function htmlButtons(source: string): Array<HtmlTag & { content: string }> {
  const buttons: Array<HtmlTag & { content: string }> = [];
  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const start = match.index ?? 0;
    buttons.push({ name: 'button', attributes: parseAttributes(match[1] ?? ''), raw: match[0], content: match[2] ?? '', start, end: start + match[0].length });
  }
  return buttons;
}

export function htmlElements(source: string, tagName: string): Array<HtmlTag & { content: string }> {
  const elements: Array<HtmlTag & { content: string }> = [];
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${escaped}\\b([^>]*)>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi');
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    elements.push({
      name: tagName.toLowerCase(),
      attributes: parseAttributes(match[1] ?? ''),
      raw: match[0],
      content: match[2] ?? '',
      start,
      end: start + match[0].length
    });
  }
  return elements;
}

export function visibleHtmlText(source: string): string {
  return source
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeStringLiteral(literal: string): string | null {
  const quote = literal[0];
  if (!quote || !['"', "'", '`'].includes(quote) || literal[literal.length - 1] !== quote) return null;
  const body = literal.slice(1, -1);
  if (quote === '`' && body.includes('${')) return null;
  return body.replace(/\\([\\'"`])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
}

function staticLiteralAt(source: string, start: number): { value: string; end: number } | null {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index += 1;
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  const begin = index;
  index += 1;
  for (; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote === '`' && char === '$' && source[index + 1] === '{') return null;
    if (char === quote) {
      const literal = source.slice(begin, index + 1);
      const value = decodeStringLiteral(literal);
      return value === null ? null : { value, end: index + 1 };
    }
  }
  return null;
}

export function staticInnerHtmlFragments(source: string): { fragments: string[]; unsupportedControlTemplates: number } {
  const fragments: string[] = [];
  let unsupportedControlTemplates = 0;
  const assignment = /\.(?:innerHTML|outerHTML)\s*=\s*/g;
  for (const match of source.matchAll(assignment)) {
    const literal = staticLiteralAt(source, (match.index ?? 0) + match[0].length);
    if (literal) fragments.push(literal.value);
    else unsupportedControlTemplates += 1;
  }
  const insertion = /\.insertAdjacentHTML\s*\(/g;
  for (const match of source.matchAll(insertion)) {
    const callStart = (match.index ?? 0) + match[0].length;
    let index = callStart;
    const first = staticLiteralAt(source, index);
    if (!first) {
      unsupportedControlTemplates += 1;
      continue;
    }
    index = first.end;
    while (/\s/.test(source[index] ?? '')) index += 1;
    if (source[index] !== ',') {
      unsupportedControlTemplates += 1;
      continue;
    }
    const html = staticLiteralAt(source, index + 1);
    if (html) fragments.push(html.value);
    else unsupportedControlTemplates += 1;
  }
  return { fragments, unsupportedControlTemplates };
}

function propertyAssignment(source: string, variable: string, property: string): string | null {
  const pattern = new RegExp(`\\b${variable}\\.${property}\\s*=\\s*([^;\\n]+)`);
  const match = source.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function literalAssignment(source: string, variable: string, property: string): string | null {
  const expression = propertyAssignment(source, variable, property);
  if (!expression) return null;
  const decoded = decodeStringLiteral(expression);
  return decoded ?? expression;
}

function hasSetAttribute(source: string, variable: string, attribute: string): boolean {
  const pattern = new RegExp(`\\b${variable}\\.setAttribute\\(\\s*['"]${attribute}['"]\\s*,`);
  return pattern.test(source);
}

function setAttributeLiteral(source: string, variable: string, attribute: string): string | null {
  const pattern = new RegExp(`\\b${variable}\\.setAttribute\\(\\s*['"]${attribute}['"]\\s*,\\s*(['"][^'"]*['"])`);
  const match = source.match(pattern);
  return match?.[1] ? decodeStringLiteral(match[1]) : null;
}

export function dynamicControls(source: string): { controls: DynamicControl[]; unsupportedCreations: number } {
  const controls: DynamicControl[] = [];
  let unsupportedCreations = 0;
  const allCreateElementCalls = [...source.matchAll(/document\.createElement\s*\(([^)]*)\)/g)];
  const assigned = new Map<number, { variable: string; tag: 'button' | 'input' }>();
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\s*\(\s*(['"])(button|input)\2\s*\)/g;
  for (const match of source.matchAll(declaration)) {
    assigned.set(source.indexOf('document.createElement', match.index ?? 0), { variable: match[1]!, tag: match[3]!.toLowerCase() as 'button' | 'input' });
  }
  for (const call of allCreateElementCalls) {
    const callIndex = call.index ?? 0;
    const literal = decodeStringLiteral((call[1] ?? '').trim());
    if (literal === null) {
      unsupportedCreations += 1;
      continue;
    }
    const tag = literal.toLowerCase();
    if (tag !== 'button' && tag !== 'input') continue;
    const binding = [...assigned.entries()].find(([index]) => index >= callIndex - 80 && index <= callIndex + 4)?.[1];
    if (!binding) {
      unsupportedCreations += 1;
      continue;
    }
    const variable = binding.variable;
    const declarationsWithName = [...source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${variable}\\b`, 'g'))].length;
    if (declarationsWithName !== 1) {
      unsupportedCreations += 1;
      continue;
    }
    const type = setAttributeLiteral(source, variable, 'type') ?? literalAssignment(source, variable, 'type');
    const id = setAttributeLiteral(source, variable, 'id') ?? literalAssignment(source, variable, 'id');
    const ariaLabel = hasSetAttribute(source, variable, 'aria-label') || propertyAssignment(source, variable, 'ariaLabel') !== null;
    const ariaLabelledBy = hasSetAttribute(source, variable, 'aria-labelledby') || propertyAssignment(source, variable, 'ariaLabelledBy') !== null;
    const textExpression = propertyAssignment(source, variable, 'textContent') ?? propertyAssignment(source, variable, 'innerText');
    const innerExpression = propertyAssignment(source, variable, 'innerHTML');
    const innerLiteral = innerExpression ? decodeStringLiteral(innerExpression) : null;
    const innerHtml = innerLiteral === null ? [] : [innerLiteral];
    const visibleText = Boolean(textExpression && decodeStringLiteral(textExpression) !== '')
      || innerHtml.some((value) => visibleHtmlText(value).length > 0);
    controls.push({ variable, tag: binding.tag, type, id, ariaLabel, ariaLabelledBy, visibleText, innerHtml });
  }
  return { controls, unsupportedCreations };
}

export function callArguments(source: string, callee: string): string[] {
  const results: string[] = [];
  let cursor = 0;
  const needle = `${callee}(`;
  while (cursor < source.length) {
    const start = source.indexOf(needle, cursor);
    if (start < 0) break;
    let index = start + needle.length;
    let depth = 1;
    let quote: string | null = null;
    for (; index < source.length; index += 1) {
      const char = source[index]!;
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`Unbalanced call for ${callee}`);
    results.push(normalizeWhitespace(source.slice(start + needle.length, index)));
    cursor = index + 1;
  }
  return results;
}

export function eventListenerTypes(source: string, receiver: string): string[] {
  const pattern = new RegExp(`\\b${receiver}\\.addEventListener\\(\\s*['"]([^'"]+)['"]`, 'g');
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}
