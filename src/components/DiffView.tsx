'use client';

import { diffLines } from 'diff';

/** Standard PR-style line diff (§3): +/- gutters, red/green rows. */
export default function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = diffLines(oldText ?? '', newText ?? '');
  let oldLine = 1;
  let newLine = 1;
  const rows: Array<{ sign: ' ' | '+' | '-'; text: string; o: number | null; n: number | null }> = [];
  for (const p of parts) {
    const lines = p.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (p.added) rows.push({ sign: '+', text: line, o: null, n: newLine++ });
      else if (p.removed) rows.push({ sign: '-', text: line, o: oldLine++, n: null });
      else rows.push({ sign: ' ', text: line, o: oldLine++, n: newLine++ });
    }
  }
  return (
    <div className="mono max-h-[400px] overflow-auto rounded-sm border border-edge bg-bg text-[11.5px] leading-5">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.sign === '+' ? 'diff-add' : r.sign === '-' ? 'diff-del' : ''}>
              <td className="w-8 select-none border-r border-edge px-1 text-right text-ink-faint">{r.o ?? ''}</td>
              <td className="w-8 select-none border-r border-edge px-1 text-right text-ink-faint">{r.n ?? ''}</td>
              <td className="w-4 select-none pl-1 text-center">{r.sign}</td>
              <td className="whitespace-pre pl-1 pr-3">{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
