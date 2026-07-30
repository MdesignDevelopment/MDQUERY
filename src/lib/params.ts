import type { QueryParamDef } from './types';

/**
 * Detect Oracle bind variables (:name) in query text, ignoring occurrences
 * inside strings/comments and PL/SQL assignment (:=).
 */
export function detectBinds(body: string): string[] {
  // Blank out strings and comments first (cheap re-scan; keeps offsets irrelevant here)
  let masked = '';
  let state: 'code' | 'lc' | 'bc' | 'str' | 'dq' = 'code';
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    if (state === 'code') {
      if (c === '-' && n === '-') { state = 'lc'; masked += '  '; i++; continue; }
      if (c === '/' && n === '*') { state = 'bc'; masked += '  '; i++; continue; }
      if (c === "'") { state = 'str'; masked += ' '; continue; }
      if (c === '"') { state = 'dq'; masked += ' '; continue; }
      masked += c;
    } else {
      masked += c === '\n' ? '\n' : ' ';
      if (state === 'lc' && c === '\n') state = 'code';
      else if (state === 'bc' && c === '/' && body[i - 1] === '*') state = 'code';
      else if (state === 'str' && c === "'") { if (n === "'") i++; else state = 'code'; }
      else if (state === 'dq' && c === '"') state = 'code';
    }
  }

  const names: string[] = [];
  const re = /(^|[^:\w]):([a-zA-Z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const name = m[2].toLowerCase();
    // skip PL/SQL trigger pseudo-records
    if (name === 'old' || name === 'new') continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Format a form value as an Oracle literal for the resolved-copy output. */
export function formatLiteral(value: string, dataType: string): string {
  if (value === '' || value == null) return 'NULL';
  switch (dataType) {
    case 'number': {
      const num = Number(value);
      return Number.isFinite(num) ? String(num) : `'${value.replace(/'/g, "''")}'`;
    }
    case 'date':
      return `TO_DATE('${value.replace(/'/g, "''")}', 'YYYY-MM-DD')`;
    default:
      return `'${value.replace(/'/g, "''")}'`;
  }
}

/**
 * Format a multi-value field (one value per line, or comma-separated) as a
 * comma-joined list of literals — for binds used inside IN (:param). The
 * query text supplies the parentheses itself (e.g. `IN (:ids)`); this only
 * produces the inner list.
 */
export function formatListLiteral(raw: string, dataType: string): string {
  const tokens = raw
    .split(/[\n\r,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return 'NULL';
  return tokens.map((t) => formatLiteral(t, dataType)).join(', ');
}

/**
 * Substitute bind variables with literal values (Form Mode "resolved copy").
 * Only touches binds outside strings/comments.
 */
export function resolveBinds(body: string, values: Record<string, string>, defs: QueryParamDef[]): string {
  const defOf = (name: string) => defs.find((d) => d.name === name);
  let out = '';
  let state: 'code' | 'lc' | 'bc' | 'str' | 'dq' = 'code';
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    if (state === 'code') {
      if (c === '-' && n === '-') { state = 'lc'; out += c; continue; }
      if (c === '/' && n === '*') { state = 'bc'; out += c; continue; }
      if (c === "'") { state = 'str'; out += c; continue; }
      if (c === '"') { state = 'dq'; out += c; continue; }
      if (c === ':' && n !== '=' && /[a-zA-Z_]/.test(n ?? '') && body[i - 1] !== ':') {
        let j = i + 1;
        while (j < body.length && /\w/.test(body[j])) j++;
        const name = body.slice(i + 1, j).toLowerCase();
        if (name !== 'old' && name !== 'new' && name in values) {
          const def = defOf(name);
          out += def?.is_list
            ? formatListLiteral(values[name], def.data_type)
            : formatLiteral(values[name], def?.data_type ?? 'text');
          i = j - 1;
          continue;
        }
      }
      out += c;
    } else {
      out += c;
      if (state === 'lc' && c === '\n') state = 'code';
      else if (state === 'bc' && c === '/' && body[i - 1] === '*') state = 'code';
      else if (state === 'str' && c === "'") { if (n === "'") { out += n; i++; } else state = 'code'; }
      else if (state === 'dq' && c === '"') state = 'code';
    }
  }
  return out;
}

const ORACLE_RESERVED = new Set([
  'select', 'insert', 'update', 'delete', 'merge', 'table', 'index', 'view', 'from', 'where',
  'group', 'order', 'having', 'union', 'minus', 'intersect', 'create', 'alter', 'drop', 'truncate',
  'grant', 'revoke', 'begin', 'end', 'declare', 'exception', 'cursor', 'trigger', 'procedure',
  'function', 'package', 'rownum', 'rowid', 'sysdate', 'user', 'null', 'not', 'and', 'or', 'like',
  'between', 'exists', 'in', 'is', 'as', 'by', 'on', 'to', 'of', 'all', 'any', 'distinct',
]);

/** Tag rules (§2.4): alphanumeric + hyphen/underscore, length cap, no Oracle reserved words. */
export function validateTag(tag: string): string | null {
  if (!tag || tag.trim() === '') return 'Tag is required.';
  if (tag.length > 64) return 'Tag must be 64 characters or fewer.';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(tag)) return 'Tag may only contain letters, digits, hyphens and underscores, and must start with a letter or digit.';
  if (ORACLE_RESERVED.has(tag.toLowerCase())) return `"${tag}" is an Oracle reserved word — pick a different tag to avoid confusion.`;
  return null;
}
