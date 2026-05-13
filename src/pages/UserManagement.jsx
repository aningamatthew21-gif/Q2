import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  UserPlus, Pencil, UserX, UserCheck, ArrowLeft, RefreshCw, Search,
  ShieldCheck, ShieldOff, Mail, Users, Crown
} from 'lucide-react';
import api from '../api';
import {
  Breadcrumb, PageTitle, Card, Button, MetricTile, StatusBadge,
  EmptyState, CommandBar, SortableHeader, useSortable, Dialog,
  usePrompt
} from '../components/v2';
import { staggerContainer, listContainer, listRow } from '../components/v2/motion';
import { useApp } from '../context/AppContext';
import { ROLE_LABEL, ROLES, ALL_ROLES } from '../utils/permissions';

/**
 * UserManagement — admin page for provisioning + role management.
 *
 * Replaces the previous "ssh in and run SQL UPDATE" workflow. Surfaces
 * the same operations the backend /api/users endpoints expose:
 *
 *   - List every account with role, status, and creation date
 *   - Invite a new user (email + role + optional name)
 *   - Inline edit: change role via dropdown
 *   - Activate / Deactivate (soft delete; preserves audit ties)
 *
 * Self-lockout protection is enforced server-side (last-admin demotion,
 * self-deactivation) — the UI surfaces those denials via the normal
 * notification path so the admin always sees why something failed.
 *
 * Page-level gate: `user.manage` permission. Only `admin` has it.
 */

const STATUS_TONES = { active: 'ok', inactive: 'muted' };

// Quick-pick groups so the role dropdown reads like an org chart, not
// just an alphabetical list.
const ROLE_GROUPS = [
  { label: 'System',      ids: [ROLES.ADMIN] },
  { label: 'Finance',     ids: [ROLES.FINANCE_HEAD, ROLES.FINANCE_OFFICER] },
  { label: 'Sales',       ids: [ROLES.SALES_HEAD, ROLES.SALES_OFFICER] },
  { label: 'Procurement', ids: [ROLES.PROCUREMENT_HEAD, ROLES.PROCUREMENT_OFFICER] },
  { label: 'External',    ids: [ROLES.CUSTOMER] }
];

export default function UserManagement({ navigateTo }) {
  const { appUser } = useApp();
  const { askConfirm } = usePrompt();
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [notice, setNotice]     = useState(null);

  const [search, setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [inviteOpen, setInviteOpen] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/users');
      if (!res.success) throw new Error(res.error || 'Failed to load users.');
      setUsers(res.data.users || []);
      setError(null);
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to load users.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Filters + sort ────────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    let rows = users;
    if (roleFilter !== 'All') rows = rows.filter(u => u.role === roleFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(u =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.name  || '').toLowerCase().includes(q));
    }
    return rows;
  }, [users, search, roleFilter]);

  const { sortKey, sortDir, toggle: toggleSort, sortedRows } =
    useSortable(filteredUsers, 'role', 'asc');

  // ── KPIs ──────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:     users.length,
    active:    users.filter(u => u.status === 'active').length,
    admins:    users.filter(u => u.role === 'admin' && u.status === 'active').length,
    inactive:  users.filter(u => u.status === 'inactive').length
  }), [users]);

  // ── Mutations ─────────────────────────────────────────────────────
  const showNotice = (type, message) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 4500);
  };

  const inviteUser = async ({ email, role, name }) => {
    try {
      const res = await api.post('/users', { email, role, name });
      if (!res.success) throw new Error(res.error || 'Failed.');
      showNotice('success', `Invited ${email}. They can sign in immediately via OTP.`);
      setInviteOpen(false);
      load();
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to invite user.';
      showNotice('error', msg);
    }
  };

  const changeRole = async (user, newRole) => {
    if (newRole === user.role) return;
    try {
      const res = await api.put(`/users/${encodeURIComponent(user.email)}`, { role: newRole });
      if (!res.success) throw new Error(res.error || 'Failed.');
      showNotice('success', `${user.email} is now ${ROLE_LABEL[newRole] || newRole}.`);
      setUsers(prev => prev.map(u => u.email === user.email ? res.user : u));
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to change role.';
      showNotice('error', msg);
      load();   // reset to true state since the local change didn't persist
    }
  };

  const setStatus = async (user, newStatus) => {
    if (newStatus === 'inactive') {
      const ok = await askConfirm({
        title:        `Deactivate ${user.email}?`,
        description:  'They keep their history and audit trail. They cannot sign in until reactivated. You cannot deactivate yourself or the last active admin.',
        confirmLabel: 'Deactivate',
        confirmTone:  'danger'
      });
      if (!ok) return;
    }
    try {
      const res = await api.put(`/users/${encodeURIComponent(user.email)}`, { status: newStatus });
      if (!res.success) throw new Error(res.error || 'Failed.');
      showNotice('success', `${user.email} ${newStatus === 'active' ? 'activated' : 'deactivated'}.`);
      setUsers(prev => prev.map(u => u.email === user.email ? res.user : u));
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to change status.';
      showNotice('error', msg);
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumb items={['Workspace', 'System', 'Users']} />
      <PageTitle
        title="User management"
        subtitle={`${stats.active} active · ${stats.inactive} inactive · ${stats.admins} admin${stats.admins === 1 ? '' : 's'}`}
        actions={
          <>
            <Button iconLeft={<ArrowLeft />} onClick={() => navigateTo('controllerDashboard')}>Back</Button>
            <Button iconLeft={<RefreshCw />} onClick={load} disabled={loading}>Refresh</Button>
            <Button variant="primary" iconLeft={<UserPlus />} onClick={() => setInviteOpen(true)}>Invite user</Button>
          </>
        }
      />

      {notice && (
        <div className={`mb-3 px-3 py-2 rounded-md text-[13px] border ${
          notice.type === 'error'
            ? 'bg-err-soft border-err/30 text-err'
            : 'bg-ok-soft border-ok/30 text-ok'
        }`}>{notice.message}</div>
      )}

      {error && (
        <Card className="mb-4 p-3 border-err/40 bg-err-soft">
          <div className="text-[13px] text-err">Failed to load users: {error}</div>
        </Card>
      )}

      {/* KPIs */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"
      >
        <MetricTile label="Total users"  value={stats.total}    format="number" />
        <MetricTile label="Active"        value={stats.active}   format="number" trend="up" />
        <MetricTile label="Administrators" value={stats.admins}  format="number" />
        <MetricTile label="Inactive"     value={stats.inactive} format="number" trend="flat" />
      </motion.div>

      {/* Toolbar / search */}
      <Card className="mb-3 p-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-n-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search email or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-[13px] bg-white border border-n-300 rounded-md text-n-800 placeholder:text-n-400 focus:outline-none focus:border-accent focus:shadow-focus"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-n-700 mr-2">Filter by role</label>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="h-8 px-2 text-[13px] bg-white border border-n-300 rounded-md text-n-800 focus:outline-none focus:border-accent focus:shadow-focus"
            >
              <option value="All">All roles</option>
              {ROLE_GROUPS.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.ids.map(id => <option key={id} value={id}>{ROLE_LABEL[id]}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="mb-3 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <div className="inline-block w-8 h-8 rounded-full border-2 border-n-100 border-t-accent animate-spin" />
            <div className="text-[13px] text-n-500 mt-2">Loading users…</div>
          </div>
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={<Users className="w-6 h-6" />}
            title="No users match these filters"
            body={search ? 'Try clearing the search.' : 'Invite your first user.'}
            action={<Button variant="primary" iconLeft={<UserPlus />} onClick={() => setInviteOpen(true)}>Invite user</Button>}
          />
        ) : (
          <motion.div variants={listContainer} initial="initial" animate="enter">
            <table className="w-full text-[13px]">
              <thead className="sticky top-12">
                <tr>
                  <th className="bg-n-50 border-b border-n-200 px-4 py-2 text-left"><SortableHeader label="Email"  sortKey="email"  current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                  <th className="bg-n-50 border-b border-n-200 px-4 py-2 text-left"><SortableHeader label="Name"   sortKey="name"   current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                  <th className="bg-n-50 border-b border-n-200 px-4 py-2 text-left"><SortableHeader label="Role"   sortKey="role"   current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                  <th className="bg-n-50 border-b border-n-200 px-4 py-2 text-left"><SortableHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                  <th className="bg-n-50 border-b border-n-200 px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-n-600 w-[220px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(u => {
                  const isSelf = u.email === appUser?.email;
                  return (
                    <motion.tr key={u.email} variants={listRow} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Mail className="w-3.5 h-3.5 text-n-400 flex-shrink-0" />
                          <span className="font-mono-num text-[12.5px] text-n-800 truncate">{u.email}</span>
                          {isSelf && (
                            <span className="text-[10.5px] px-1.5 py-0.5 rounded-pill bg-accent-soft text-accent-text font-semibold">you</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-n-700">{u.name || <span className="text-n-400 italic">—</span>}</td>
                      <td className="px-4 py-2">
                        <select
                          value={u.role}
                          onChange={(e) => changeRole(u, e.target.value)}
                          className="h-7 px-2 text-[12.5px] bg-white border border-n-300 rounded-md text-n-800 focus:outline-none focus:border-accent focus:shadow-focus"
                          title="Change role"
                          disabled={u.status === 'inactive'}
                        >
                          {ROLE_GROUPS.map(g => (
                            <optgroup key={g.label} label={g.label}>
                              {g.ids.map(id => <option key={id} value={id}>{ROLE_LABEL[id]}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        {u.role === 'admin' && <Crown className="inline w-3.5 h-3.5 text-warn ml-1.5" title="Administrator" />}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={STATUS_TONES[u.status] || 'muted'}>
                          {u.status === 'active' ? 'Active' : 'Inactive'}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {u.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="danger"
                            iconLeft={<UserX />}
                            onClick={() => setStatus(u, 'inactive')}
                            disabled={isSelf}
                            title={isSelf ? "You can't deactivate yourself." : 'Deactivate user'}
                          >Deactivate</Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            iconLeft={<UserCheck />}
                            onClick={() => setStatus(u, 'active')}
                          >Reactivate</Button>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )}
      </Card>

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSubmit={inviteUser}
      />
    </>
  );
}

// ── Invite dialog ─────────────────────────────────────────────────
function InviteUserDialog({ open, onClose, onSubmit }) {
  const [email, setEmail]   = useState('');
  const [name,  setName]    = useState('');
  const [role,  setRole]    = useState(ROLES.SALES_OFFICER);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setEmail(''); setName(''); setRole(ROLES.SALES_OFFICER); setSubmitting(false); }
  }, [open]);

  const submit = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    try { await onSubmit({ email: email.trim().toLowerCase(), role, name: name.trim() }); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite a new user"
      description="The user can sign in immediately via email OTP. Send them the URL — no password to communicate."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconLeft={<UserPlus />} onClick={submit} disabled={submitting || !email.trim()}>
            {submitting ? 'Inviting…' : 'Send invite'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-semibold text-n-700 mb-1">Email <span className="text-err">*</span></label>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="newuser@company.com"
            className="w-full h-9 px-3 text-[13px] bg-white border border-n-300 rounded-md text-n-800 placeholder:text-n-400 focus:outline-none focus:border-accent focus:shadow-focus"
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-n-700 mb-1">Display name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full h-9 px-3 text-[13px] bg-white border border-n-300 rounded-md text-n-800 placeholder:text-n-400 focus:outline-none focus:border-accent focus:shadow-focus"
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-n-700 mb-1">Role <span className="text-err">*</span></label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full h-9 px-2 text-[13px] bg-white border border-n-300 rounded-md text-n-800 focus:outline-none focus:border-accent focus:shadow-focus"
          >
            {ROLE_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.ids.map(id => <option key={id} value={id}>{ROLE_LABEL[id]}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="text-[11.5px] text-n-500 mt-1.5">
            <ShieldCheck className="inline w-3.5 h-3.5 mr-1 text-n-400" />
            Heads can approve and sign; officers cannot.
          </div>
        </div>
      </div>
    </Dialog>
  );
}
