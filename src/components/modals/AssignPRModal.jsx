/**
 * AssignPRModal — procurement-head's PR-to-officer assignment dialog.
 *
 * Replaces the previous one-click "Assign to me" button on the PR detail
 * page. The head clicks "Assign" → this modal opens, loads the active
 * procurement-department user list from the backend, and lets the head
 * pick (with a quick "Assign to me" shortcut at the top).
 *
 * Why a dedicated modal and not an inline dropdown:
 *   - The user list can grow (officers + heads + future contractors),
 *     so a searchable list scales better than a select element.
 *   - Reassignment is a deliberate action that should surface intent —
 *     a modal pause forces the head to confirm rather than mis-click.
 *   - Reuses the existing v2 Dialog primitive for focus-trap, scroll-
 *     lock, Escape-to-close, and focus-restore behaviour.
 *
 * Wiring:
 *   <AssignPRModal
 *      open={modalOpen}
 *      onClose={() => setModalOpen(false)}
 *      prId={pr.id}
 *      prNumber={pr.prNumber}
 *      currentAssignedTo={pr.assignedTo}
 *      currentUserEmail={userEmail}
 *      onAssigned={() => fetchPR()}        // refresh on success
 *   />
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';
import Icon from '../common/Icon';

const AssignPRModal = ({
    open,
    onClose,
    prId,
    prNumber,
    currentAssignedTo,
    currentUserEmail,
    onAssigned
}) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(currentAssignedTo || '');
    const searchRef = useRef(null);

    // Fetch the procurement-department user list when the modal opens.
    // Re-runs on every open so a freshly-promoted officer shows up
    // without requiring a page reload.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setSelected(currentAssignedTo || '');
        setSearch('');

        api.get('/users/department/procurement')
            .then(res => {
                if (cancelled) return;
                if (res.success && Array.isArray(res.data?.users)) {
                    setUsers(res.data.users);
                } else {
                    setError('Could not load procurement users.');
                }
            })
            .catch(err => {
                if (cancelled) return;
                const status = err?.response?.status;
                const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
                setError(status === 403
                    ? "You don't have permission to view the procurement directory."
                    : `Failed to load users (${status || 'network'}): ${msg}`);
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [open, currentAssignedTo]);

    // Filter the list as the user types. Matches against name and email so
    // either "alice" or "alice@" narrows the list. Case-insensitive.
    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return users;
        return users.filter(u =>
            (u.name || '').toLowerCase().includes(term) ||
            (u.email || '').toLowerCase().includes(term)
        );
    }, [users, search]);

    const handleAssign = async (targetEmail) => {
        if (!targetEmail || targetEmail === currentAssignedTo) {
            onClose();
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await api.put(`/purchase-requisitions/${prId}`, { assignedTo: targetEmail });
            if (onAssigned) onAssigned(targetEmail);
            onClose();
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(status === 403
                ? msg // server returns a clear sentence; just show it
                : `Failed to assign (${status || 'network'}): ${msg}`);
            setSaving(false);
        }
    };

    const handleUnassign = () => handleAssign(''); // send empty string → cleared

    // "Assign to me" is shown at top of list when current user isn't
    // already the assignee. Convenience for heads who do take work.
    const showAssignToMe = currentUserEmail && currentAssignedTo !== currentUserEmail;
    const meRecord = users.find(u => u.email === currentUserEmail);

    return (
        <Dialog
            open={open}
            onClose={saving ? undefined : onClose}
            title={currentAssignedTo ? `Reassign ${prNumber || 'PR'}` : `Assign ${prNumber || 'PR'}`}
            description={
                currentAssignedTo
                    ? `Currently assigned to ${currentAssignedTo}. Pick a new assignee below.`
                    : 'Pick a procurement officer or head to own this requisition.'
            }
            size="md"
            initialFocusRef={searchRef}
        >
            <div className="space-y-4">
                {error && (
                    <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {/* Quick action: Assign to me */}
                {showAssignToMe && (
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleAssign(currentUserEmail)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-left transition-colors disabled:opacity-50"
                    >
                        <div>
                            <div className="text-sm font-semibold text-blue-800">Assign to me</div>
                            <div className="text-xs text-blue-700">{currentUserEmail}</div>
                        </div>
                        <Icon id="user" className="w-4 h-4 text-blue-600" />
                    </button>
                )}

                {/* Search box */}
                <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search procurement users by name or email…"
                    disabled={loading || saving}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm"
                />

                {/* User list */}
                <div className="border border-gray-200 rounded-md max-h-72 overflow-y-auto">
                    {loading ? (
                        <div className="p-4 text-center text-sm text-gray-500">Loading users…</div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="p-4 text-center text-sm text-gray-500">
                            {search ? 'No users match your search.' : 'No active procurement users.'}
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {filteredUsers.map(u => {
                                const isCurrent  = u.email === currentAssignedTo;
                                const isSelected = u.email === selected;
                                return (
                                    <li key={u.email}>
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setSelected(u.email)}
                                            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                                                isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                                            }`}
                                        >
                                            <div>
                                                <div className="text-sm font-medium text-gray-800">
                                                    {u.name || u.email}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {u.email} · {u.roleLabel || u.role}
                                                </div>
                                            </div>
                                            {isCurrent && (
                                                <span className="text-xs text-gray-500 italic">currently assigned</span>
                                            )}
                                            {isSelected && !isCurrent && (
                                                <Icon id="check" className="w-4 h-4 text-blue-600" />
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Action row */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    {currentAssignedTo ? (
                        <button
                            type="button"
                            disabled={saving}
                            onClick={handleUnassign}
                            className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                            Clear assignment
                        </button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleAssign(selected)}
                            disabled={saving || !selected || selected === currentAssignedTo}
                        >
                            {saving ? 'Assigning…' : 'Assign'}
                        </Button>
                    </div>
                </div>
            </div>
        </Dialog>
    );
};

export default AssignPRModal;
