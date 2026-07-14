'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDialogs } from '@/components/Dialogs';

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  department: string;
  active: boolean;
  query_count: number;
  workflow_count: number;
}

const ROLES = ['user', 'lead', 'curator', 'admin'];
const DEPARTMENTS = ['Support', 'GIS', 'DevOps', 'Sales Ops'];

/**
 * Admin-only user management: create accounts, change roles/departments,
 * reset passwords, deactivate/reactivate. No self-registration exists —
 * this page is the only way accounts are provisioned (until SSO).
 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', role: 'user', department: 'Support', password: '' });
  const [forbidden, setForbidden] = useState(false);
  const { confirm, promptText, dialogs } = useDialogs();

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/users');
    if (r.status === 403) { setForbidden(true); return; }
    const d = await r.json();
    setUsers(d.users ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(msg: string, isError = false) {
    (isError ? setError : setNotice)(msg);
    setTimeout(() => { setNotice(''); setError(''); }, 3000);
  }

  async function update(id: number, patch: Record<string, unknown>, okMsg: string) {
    const r = await fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error ?? 'Failed', true);
    flash(okMsg);
    load();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error ?? 'Failed', true);
    setCreating(false);
    setDraft({ name: '', email: '', role: 'user', department: 'Support', password: '' });
    flash(`Account created for ${d.user.name}.`);
    load();
  }

  async function resetPassword(u: AdminUser) {
    const pw = await promptText({
      title: `Reset password for ${u.name}`,
      label: 'New password (min 8 characters)',
      type: 'password',
      minLength: 8,
      confirmLabel: 'Reset password',
    });
    if (!pw) return;
    update(u.id, { password: pw }, `Password reset for ${u.name}.`);
  }

  if (forbidden) {
    return <div className="p-6 text-xs text-ink-faint">User management is admin-only.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {dialogs}
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">User Management</h1>
        <span className="text-[11px] text-ink-faint">accounts are admin-provisioned — no self-registration</span>
        {notice && <span className="text-[11px]" style={{ color: 'var(--risk-safe)' }}>{notice}</span>}
        {error && <span className="text-[11px]" style={{ color: 'var(--risk-high)' }} role="alert">{error}</span>}
        <span className="flex-1" />
        <button className="btn btn-primary" onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : '+ New user'}</button>
      </header>

      {creating && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2 border-b border-edge bg-panel-2 px-4 py-3">
          <label className="text-[11px]">
            <span className="mb-1 block text-ink-dim">Name</span>
            <input className="input w-40" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block text-ink-dim">Email</span>
            <input className="input w-56" type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@mdesignsolutions.be" />
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block text-ink-dim">Role</span>
            <select className="input w-28" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block text-ink-dim">Department</span>
            <select className="input w-28" value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })}>
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block text-ink-dim">Initial password (min 8)</span>
            <input className="input w-40" type="text" required minLength={8} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
          </label>
          <button className="btn btn-primary" type="submit">Create</button>
        </form>
      )}

      <div className="flex-1">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-edge text-left text-[10px] uppercase tracking-widest text-ink-faint">
              <th className="px-4 py-2 font-normal">User</th>
              <th className="px-2 py-2 font-normal">Role</th>
              <th className="px-2 py-2 font-normal">Department</th>
              <th className="px-2 py-2 font-normal">Owns</th>
              <th className="px-2 py-2 font-normal">Status</th>
              <th className="px-2 py-2 font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-b border-edge ${u.active ? '' : 'opacity-50'}`}>
                <td className="px-4 py-2">
                  <div className="font-medium">{u.name}</div>
                  <div className="mono text-[10px] text-ink-faint">{u.email}</div>
                </td>
                <td className="px-2 py-2">
                  <select className="input mono w-24" value={u.role} onChange={(e) => update(u.id, { role: e.target.value }, `${u.name} is now ${e.target.value}.`)} aria-label={`Role for ${u.name}`}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select className="input w-28" value={u.department} onChange={(e) => update(u.id, { department: e.target.value }, `Moved ${u.name} to ${e.target.value}.`)} aria-label={`Department for ${u.name}`}>
                    {DEPARTMENTS.includes(u.department) ? null : <option>{u.department}</option>}
                    {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </td>
                <td className="mono px-2 py-2 text-[11px] text-ink-faint">{u.query_count}q · {u.workflow_count}w</td>
                <td className="px-2 py-2">
                  <span className="badge" style={u.active
                    ? { color: 'var(--risk-safe)', border: '1px solid var(--risk-safe)' }
                    : { color: 'var(--ink-faint)', border: '1px solid var(--edge)' }}>
                    {u.active ? 'active' : 'deactivated'}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-1.5">
                    <button className="btn" onClick={() => resetPassword(u)}>Reset password</button>
                    {u.active ? (
                      <button
                        className="btn"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Deactivate ${u.name}?`,
                            message: 'They can no longer sign in. Their dictionary and history are kept, and you can reactivate them anytime.',
                            confirmLabel: 'Deactivate',
                            danger: true,
                          });
                          if (ok) update(u.id, { active: false }, `${u.name} deactivated.`);
                        }}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button className="btn" onClick={() => update(u.id, { active: true }, `${u.name} reactivated.`)}>Reactivate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <div className="p-6 text-xs text-ink-faint">Loading…</div>}
      </div>
    </div>
  );
}
