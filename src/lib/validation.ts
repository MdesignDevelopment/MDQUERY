import type { LintFinding, RiskLevel, ValidationResult } from './types';

/**
 * Static, offline validation of Oracle SQL / PL/SQL text.
 * The platform never connects to any database (client-owned or otherwise),
 * so everything here is text/AST-level analysis only — no schema introspection,
 * no cardinality estimation. See spec §2.5.
 *
 * Production upgrade path: swap the tokenizer heuristics for a full ANTLR
 * PL/SQL grammar parse; the finding shape stays the same.
 */

interface Token {
  ch: string;
  line: number;
  col: number;
  inCode: boolean; // false inside comments/strings
}

/** Walk the text char-by-char tracking string/comment state. */
function scan(text: string): { tokens: Token[]; findings: LintFinding[] } {
  const findings: LintFinding[] = [];
  const tokens: Token[] = [];
  let line = 1;
  let col = 1;
  type State = 'code' | 'line_comment' | 'block_comment' | 'string' | 'dquote';
  let state: State = 'code';
  let stateStart = { line: 1, col: 1 };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    let inCode = false;

    switch (state) {
      case 'code':
        if (c === '-' && next === '-') {
          state = 'line_comment';
        } else if (c === '/' && next === '*') {
          state = 'block_comment';
          stateStart = { line, col };
        } else if (c === "'") {
          state = 'string';
          stateStart = { line, col };
        } else if (c === '"') {
          state = 'dquote';
          stateStart = { line, col };
        } else {
          inCode = true;
        }
        break;
      case 'line_comment':
        if (c === '\n') state = 'code';
        break;
      case 'block_comment':
        if (c === '/' && text[i - 1] === '*' ) state = 'code';
        break;
      case 'string':
        if (c === "'") {
          if (next === "'") { i++; col++; } // escaped quote
          else state = 'code';
        }
        break;
      case 'dquote':
        if (c === '"') state = 'code';
        break;
    }

    tokens.push({ ch: c, line, col, inCode: inCode && state === 'code' });
    if (c === '\n') { line++; col = 1; } else { col++; }
  }

  if (state === 'string' || state === 'dquote') {
    findings.push({
      severity: 'error', code: 'SYN-STRING',
      message: 'Unterminated string literal / quoted identifier.',
      line: stateStart.line, col: stateStart.col,
    });
  }
  if (state === 'block_comment') {
    findings.push({
      severity: 'error', code: 'SYN-COMMENT',
      message: 'Unterminated block comment.',
      line: stateStart.line, col: stateStart.col,
    });
  }
  return { tokens, findings };
}

/** Code-only text with strings/comments blanked (same length, positions preserved). */
function codeMask(tokens: Token[]): string {
  return tokens.map((t) => (t.inCode || t.ch === '\n' ? t.ch : t.ch === '\n' ? '\n' : ' ')).join('');
}

interface Statement {
  text: string; // masked text of statement
  raw: string;
  line: number;
  col: number;
}

/**
 * Split into statements on top-level semicolons. If the body looks like a
 * single PL/SQL block (DECLARE/BEGIN/CREATE ... ), keep it whole.
 */
function splitStatements(masked: string, raw: string): Statement[] {
  const trimmed = masked.trim().toUpperCase();
  const isBlock = /^(DECLARE|BEGIN)\b/.test(trimmed) || /^CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b/.test(trimmed);
  const out: Statement[] = [];
  if (isBlock) {
    const pos = offsetToLineCol(masked, masked.length - masked.trimStart().length);
    out.push({ text: masked, raw, line: pos.line, col: pos.col });
    return out;
  }
  let start = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ';') {
      const seg = masked.slice(start, i);
      if (seg.trim().length > 0) {
        const lead = seg.length - seg.trimStart().length;
        const pos = offsetToLineCol(masked, start + lead);
        out.push({ text: seg, raw: raw.slice(start, i), line: pos.line, col: pos.col });
      }
      start = i + 1;
    }
  }
  return out;
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1, col = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; col = 1; } else col++;
  }
  return { line, col };
}

const STMT_START = /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|BEGIN|DECLARE|CALL|EXPLAIN|LOCK|COMMIT|ROLLBACK|SAVEPOINT|SET)\b/i;

function classify(stmt: string): string {
  const s = stmt.trim().toUpperCase();
  if (/^(SELECT|WITH)\b/.test(s)) return 'SELECT';
  if (/^INSERT\b/.test(s)) return 'INSERT';
  if (/^UPDATE\b/.test(s)) return 'UPDATE';
  if (/^DELETE\b/.test(s)) return 'DELETE';
  if (/^MERGE\b/.test(s)) return 'MERGE';
  if (/^(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT)\b/.test(s)) return 'DDL';
  if (/^(BEGIN|DECLARE)\b/.test(s)) return 'PLSQL_BLOCK';
  return 'OTHER';
}

export function validateSql(body: string): ValidationResult {
  const findings: LintFinding[] = [];
  const { tokens, findings: scanFindings } = scan(body);
  findings.push(...scanFindings);
  const masked = codeMask(tokens);

  // Parenthesis balance (code only)
  let depth = 0;
  let firstUnbalanced: Token | null = null;
  for (const t of tokens) {
    if (!t.inCode) continue;
    if (t.ch === '(') depth++;
    if (t.ch === ')') {
      depth--;
      if (depth < 0 && !firstUnbalanced) firstUnbalanced = t;
    }
  }
  if (firstUnbalanced) {
    findings.push({ severity: 'error', code: 'SYN-PAREN', message: 'Unmatched closing parenthesis.', line: firstUnbalanced.line, col: firstUnbalanced.col });
  } else if (depth > 0) {
    findings.push({ severity: 'error', code: 'SYN-PAREN', message: `${depth} unclosed parenthesis${depth > 1 ? 'es' : ''}.`, line: 1, col: 1 });
  }

  const statements = splitStatements(masked, body);
  if (statements.length === 0 && body.trim().length > 0 && findings.length === 0) {
    findings.push({ severity: 'error', code: 'SYN-EMPTY', message: 'No parsable statement found.', line: 1, col: 1 });
  }

  const kinds: string[] = [];
  let risk: RiskLevel = 'safe';
  const bump = (to: RiskLevel) => {
    const order: RiskLevel[] = ['safe', 'scoped_write', 'high_risk'];
    if (order.indexOf(to) > order.indexOf(risk)) risk = to;
  };

  for (const st of statements) {
    const kind = classify(st.text);
    kinds.push(kind);
    const upper = st.text.toUpperCase();

    if (!STMT_START.test(st.text) && kind === 'OTHER') {
      findings.push({
        severity: 'error', code: 'SYN-KEYWORD',
        message: 'Statement does not begin with a recognized SQL or PL/SQL keyword.',
        line: st.line, col: st.col,
      });
    }

    // UPDATE/DELETE without WHERE — the hard gate (§2.5)
    if (kind === 'UPDATE' || kind === 'DELETE') {
      if (!/\bWHERE\b/.test(upper)) {
        bump('high_risk');
        findings.push({
          severity: 'warning', code: 'SAFE-NOWHERE',
          message: `${kind} statement has no WHERE clause — it will affect every row in the table. Saving requires typed confirmation.`,
          line: st.line, col: st.col,
          requires: 'CONFIRM_NO_WHERE',
        });
      } else {
        bump('scoped_write');
      }
    }
    if (kind === 'INSERT' || kind === 'MERGE') bump('scoped_write');

    if (kind === 'DDL') {
      bump('high_risk');
      const verb = upper.trim().split(/\s+/)[0];
      findings.push({
        severity: 'warning', code: 'SAFE-DDL',
        message: `${verb} is a structural/irreversible operation. Saving requires an explicit acknowledgment.`,
        line: st.line, col: st.col,
        requires: 'ACK_DDL',
      });
    }

    if (kind === 'PLSQL_BLOCK') {
      // Risk from DML inside the block
      if (/\b(UPDATE|DELETE)\b/.test(upper)) {
        bump(/\bWHERE\b/.test(upper) ? 'scoped_write' : 'high_risk');
        if (!/\bWHERE\b/.test(upper)) {
          findings.push({
            severity: 'warning', code: 'SAFE-NOWHERE',
            message: 'PL/SQL block contains UPDATE/DELETE with no WHERE clause anywhere in the block. Saving requires typed confirmation.',
            line: st.line, col: st.col,
            requires: 'CONFIRM_NO_WHERE',
          });
        }
      } else if (/\bINSERT\b/.test(upper)) bump('scoped_write');
      if (/\b(DROP|TRUNCATE|ALTER)\b/.test(upper)) {
        bump('high_risk');
        findings.push({
          severity: 'warning', code: 'SAFE-DDL',
          message: 'PL/SQL block contains DDL (DROP/TRUNCATE/ALTER). Saving requires an explicit acknowledgment.',
          line: st.line, col: st.col,
          requires: 'ACK_DDL',
        });
      }
      if (/\bEXECUTE\s+IMMEDIATE\b/.test(upper)) {
        findings.push({
          severity: 'info', code: 'ADV-EXECIMM',
          message: 'EXECUTE IMMEDIATE (dynamic SQL) detected — double-check the statement it builds; static analysis cannot see inside it.',
          line: st.line, col: st.col,
        });
      }
      if (/\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(upper) && !/\bEXCEPTION\b/.test(upper)) {
        findings.push({
          severity: 'info', code: 'ADV-NOEXC',
          message: 'PL/SQL block performs DML but has no EXCEPTION handler — consider handling errors explicitly.',
          line: st.line, col: st.col,
        });
      }
    }

    // Injection heuristic: string concatenation next to a quoted literal in dynamic SQL context
    if (/\|\|/.test(st.text) && /\bEXECUTE\s+IMMEDIATE\b/.test(upper)) {
      findings.push({
        severity: 'warning', code: 'SAFE-INJ',
        message: 'Dynamic SQL built with || string concatenation — use bind variables (USING clause) instead of concatenated values.',
        line: st.line, col: st.col,
      });
    }

    // SELECT * anti-pattern
    const starMatch = /\bSELECT\s+\*/i.exec(st.text);
    if (starMatch) {
      const pos = offsetToLineCol(masked, masked.indexOf(st.text) >= 0 ? masked.indexOf(st.text) + starMatch.index : 0);
      findings.push({
        severity: 'info', code: 'BP-SELECTSTAR',
        message: 'SELECT * — prefer an explicit column list for stable, reviewable output.',
        line: pos.line || st.line, col: pos.col || st.col,
      });
    }
  }

  // Unparameterized literals in WHERE (encourage binds) — checked on raw statements
  for (const st of statements) {
    const whereIdx = st.text.toUpperCase().indexOf('WHERE');
    if (whereIdx === -1) continue;
    const rawTail = st.raw.slice(whereIdx);
    if (/=\s*'[^']*'/.test(rawTail) || /=\s*\d+/.test(rawTail)) {
      if (!/:\w+/.test(rawTail)) {
        findings.push({
          severity: 'info', code: 'BP-LITERAL',
          message: 'WHERE clause compares against hard-coded literals — consider a bind variable (:name) so the query is reusable via Form Mode.',
          line: st.line, col: st.col,
        });
      }
    }
  }

  const ok = !findings.some((f) => f.severity === 'error');
  return { findings, risk_level: risk, statement_kinds: kinds, ok };
}

/** Confirmation tokens still owed given a validation result and what the user supplied. */
export function missingConfirmations(result: ValidationResult, supplied: string[]): string[] {
  const needed = new Set(result.findings.filter((f) => f.requires).map((f) => f.requires!));
  return [...needed].filter((n) => !supplied.includes(n));
}
