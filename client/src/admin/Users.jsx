import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth, API_URL } from '../lib/apiClient';
import BrandHeader from '../lib/BrandHeader';
import LoadingButton from '../components/LoadingButton.jsx';
import SkeletonRow from '../components/SkeletonRow.jsx';
import { notifyError, notifySuccess } from '../lib/notifications.js';

// Full list of supported roles (keep in sync with backend)
const ROLE_OPTIONS = [
  'user',
  'admin',
  'superadmin',
  'manager',
  'sales_manager',
  'property_consultant',
  'financial_manager',
  'financial_admin',
  'crm_admin',
  'contract_manager',
  'contract_person',
  'chairman',
  'vice_chairman',
  'ceo'
];

// --- Main Component ---

export default function Users() {
    const navigate = useNavigate();
    // --- State Management ---
    const [users, setUsers] = useState([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [busyId, setBusyId] = useState(null); // Tracks which user row is busy
    const [creating, setCreating] = useState(false);
    
    // Form and filter states
    const [createForm, setCreateForm] = useState({ email: '', password: '', role: 'user', fullName: '' });
    const [editingId, setEditingId] = useState(null);
    const [editEmail, setEditEmail] = useState('');
    const [filters, setFilters] = useState({ status: 'active', role: 'all', search: '', onlyNoManager: false });
    const [assignMap, setAssignMap] = useState({}); // { [userId]: managerId }

    const [me, setMe] = useState(null);

    // Position history modal state
    const [historyForId, setHistoryForId] = useState(null);
    const [historyItems, setHistoryItems] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    // --- Data Loading ---
    async function loadData() {
        setIsLoading(true);
        setError('');
        try {
            const [usersResp, salesResp, contractsResp, financeResp, meResp] = await Promise.all([
                fetchWithAuth(`${API_URL}/api/auth/users`),
                fetchWithAuth(`${API_URL}/api/workflow/sales-teams/memberships?active=true`).catch(() => null),
                fetchWithAuth(`${API_URL}/api/workflow/contracts-teams/memberships?active=true`).catch(() => null),
                fetchWithAuth(`${API_URL}/api/workflow/finance-teams/memberships?active=true`).catch(() => null),
                fetchWithAuth(`${API_URL}/api/auth/me`)
            ]);

            if (!usersResp.ok) throw new Error('Failed to load users');
            const usersData = await usersResp.json();
            setUsers(usersData.users || []);

            const assign = { sales: {}, contracts: {}, finance: {} };
            if (salesResp && salesResp.ok) {
                const memData = await salesResp.json();
                (memData.memberships || []).forEach(m => {
                    assign.sales[m.member_user_id] = String(m.manager_user_id);
                });
            }
            if (contractsResp && contractsResp.ok) {
                const memData = await contractsResp.json();
                (memData.memberships || []).forEach(m => {
                    assign.contracts[m.member_user_id] = String(m.manager_user_id);
                });
            }
            if (financeResp && financeResp.ok) {
                const memData = await financeResp.json();
                (memData.memberships || []).forEach(m => {
                    assign.finance[m.member_user_id] = String(m.manager_user_id);
                });
            }
            setAssignMap(assign);

            if (!meResp.ok) throw new Error('Failed to load current user profile');
            const meData = await meResp.json();
            setMe(meData.user);

        } catch (e) {
            setError(e.message || 'An unknown error occurred.');
            notifyError(e, 'Failed to load users');
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    // --- Event Handlers & Actions ---

    // A generic handler to simplify managing multiple API actions on user rows
    const handleUserAction = async (userId, action, successMsg) => {
        setBusyId(userId);
        setError('');
        try {
            await action();
            if (successMsg) notifySuccess(successMsg);
            await loadData(); // Reload data on success
        } catch (err) {
            const msg = err.message || 'Action failed.';
            setError(msg);
            notifyError(err, msg);
        } finally {
            setBusyId(null);
        }
    };
    
    const createUser = (e) => {
        e.preventDefault();
        setCreating(true);
        handleUserAction(null, async () => {
            const payload = {
                email: createForm.email,
                password: createForm.password,
                role: createForm.role,
                meta: createForm.fullName ? { full_name: createForm.fullName } : {}
            };
            const resp = await fetchWithAuth(`${API_URL}/api/auth/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) {
                const errorData = await resp.json().catch(() => ({ error: { message: 'An unknown error occurred' } }));
                throw new Error(errorData.error?.message || 'Failed to create user');
            }
            setCreateForm({ email: '', password: '', role: 'user', fullName: '' }); // Reset form
        }, 'User created successfully.').finally(() => setCreating(false));
    };

    const saveEmail = (userId) => {
        handleUserAction(userId, async () => {
            const resp = await fetchWithAuth(`${API_URL}/api/auth/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: editEmail }),
            });
            if (!resp.ok) {
                const errorData = await resp.json().catch(() => ({ error: { message: 'An unknown error occurred' } }));
                throw new Error(errorData.error?.message || 'Failed to update user');
            }
            setEditingId(null);
            setEditEmail('');
        }, 'Email updated successfully.');
    };

    // Position history modal actions
    const openHistory = async (userId) => {
        setHistoryForId(userId);
        setHistoryLoading(true);
        setHistoryItems([]);
        try {
            const resp = await fetchWithAuth(`${API_URL}/api/auth/users/${userId}/audit`);
            const data = await resp.json();
            if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load history');
            const items = (data.audit || []).filter(a => a.action === 'set_role');

            // Compute humanized from -> to by looking at previous entries
            const parsedAsc = [...items]
              .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
              .map((it, idx, arr) => {
                let toRole = ''
                try { toRole = (it.details && typeof it.details === 'object') ? it.details.new_role : JSON.parse(it.details || '{}').new_role } catch {}
                const prev = idx > 0 ? arr[idx - 1] : null
                let fromRole = ''
                if (prev) {
                  try { fromRole = (prev.details && typeof prev.details === 'object') ? prev.details.new_role : JSON.parse(prev.details || '{}').new_role } catch {}
                }
                return { ...it, _fromRole: fromRole || 'unknown', _toRole: toRole || 'unknown' }
              })

            // Show newest first
            setHistoryItems(parsedAsc.reverse());
        } catch (e) {
            const msg = e.message || 'Failed to load history';
            setError(msg);
            notifyError(e, msg);
        } finally {
            setHistoryLoading(false);
        }
    };
    const closeHistory = () => {
        setHistoryForId(null);
        setHistoryItems([]);
        setHistoryLoading(false);
    };
    
    const changeRole = (userId, role) => {
        handleUserAction(userId, async () => {
            const resp = await fetchWithAuth(`${API_URL}/api/auth/users/${userId}/role`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role }),
            });
            if (!resp.ok) {
                const errorData = await resp.json().catch(() => ({ error: { message: 'An unknown error occurred' } }));
                throw new Error(errorData.error?.message || 'Failed to change role');
            }
        }, 'Role updated successfully.');
    };

    const toggleActive = (user) => {
        handleUserAction(user.id, async () => {
            const resp = await fetchWithAuth(`${API_URL}/api/auth/users/${user.id}/active`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !user.active }),
            });
            if (!resp.ok) {
                const errorData = await resp.json().catch(() => ({ error: { message: 'An unknown error occurred' } }));
                throw new Error(errorData.error?.message || 'Failed to toggle active status');
            }
}, user.active ? 'User deactivated successfully.' : 'User activated successfully.');    };

    const handleLogout = () => {
        // In a real app, this would clear tokens and redirect
        console.log("Logging out...");
        window.location.href = '/login';
    };

    // --- Filtering and Derived State ---
    const filteredUsers = users.filter(u => {
        if (filters.status !== 'all') {
            if (filters.status === 'active' && !u.active) return false;
            if (filters.status === 'inactive' && u.active) return false;
        }
        if (filters.role !== 'all' && u.role !== filters.role) return false;
        const q = filters.search.trim().toLowerCase();
        if (q && !(u.email || '').toLowerCase().includes(q) && !(u.notes || '').toLowerCase().includes(q)) {
            return false;
        }
        if (filters.onlyNoManager) {
            const hasManager = assignMap[u.id] != null && assignMap[u.id] !== '';
            if (hasManager) return false;
        }
        return true;
    });
    
    const managers = users.filter(u => u.role.includes('manager'));
    const userById = Object.fromEntries(users.map(u => [u.id, u]));
    const isSuperAdmin = me?.role === 'superadmin';

    // helper: resolve manager for a given user based on role
    function getManagerIdForUser(u) {
      if (!u) return null;
      const r = String(u.role || '');
      if (r === 'property_consultant') return assignMap?.sales?.[u.id] || null;
      if (r === 'contract_person') return assignMap?.contracts?.[u.id] || null;
      if (r === 'financial_admin') return assignMap?.finance?.[u.id] || null;
      // other roles don't have a manager mapping here
      return null;
    }

    // --- Render ---
    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            <BrandHeader onLogout={handleLogout} />
            <main className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6">User Management</h2>

                {/* Create User Form */}
                <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
                    <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="email">Email</label>
                                <input id="email" type="email" placeholder="new.user@example.com" value={createForm.email} onChange={e => setCreateForm(s => ({ ...s, email: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="password">Password</label>
                                <input id="password" type="password" placeholder="Min 6 characters" value={createForm.password} onChange={e => setCreateForm(s => ({ ...s, password: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="fullName">Full Name</label>
                                <input id="fullName" type="text" placeholder="Employee full name" value={createForm.fullName} onChange={e => setCreateForm(s => ({ ...s, fullName: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg" />
                            </div>
                        </div>
                        {isSuperAdmin ? (
                          <div>
                              <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="role">Role</label>
                              <select id="role" value={createForm.role} onChange={e => setCreateForm(s => ({ ...s, role: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg">
                                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                              </select>
                          </div>
                        ) : (
                          <div>
                              <label className="block text-sm font-medium text-gray-600 mb-1">Role</label>
                              <input type="text" value="user" readOnly className="w-full p-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600" />
                          </div>
                        )}
                        <LoadingButton type="submit" loading={creating} variant="primary">
                            {creating ? 'Creating…' : 'Create User'}
                        </LoadingButton>
                    </form>
                </div>

                {/* Filters */}
                <div className="bg-white p-4 rounded-lg shadow-sm mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                    <input type="text" placeholder="Search by email or notes..." value={filters.search} onChange={e => setFilters(s => ({ ...s, search: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg" />
                    <select value={filters.role} onChange={e => setFilters(s => ({ ...s, role: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg">
                        <option value="all">All Roles</option>
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                    <select value={filters.status} onChange={e => setFilters(s => ({ ...s, status: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg">
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="all">All Statuses</option>
                    </select>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={filters.onlyNoManager} onChange={e => setFilters(s => ({ ...s, onlyNoManager: e.target.checked }))} />
                      Only without manager
                    </label>
                </div>
                
                {error && <p className="bg-red-100 text-red-700 p-3 rounded-lg mb-6 text-center">{error}</p>}
                
                {/* Users Table */}
                <div className="overflow-x-auto bg-white rounded-lg shadow-sm">
                    <table className="w-full text-sm text-left text-gray-700">
                        <thead className="bg-gray-100 text-xs text-gray-700 uppercase">
                            <tr>
                                <th className="px-6 py-3">User</th>
                                <th className="px-6 py-3">Role</th>
                                <th className="px-6 py-3">Manager</th>
                                <th className="px-6 py-3">Status</th>
                                <th className="px-6 py-3">Role Change</th>
                                <th className="px-6 py-3">Last Updated</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading || !me ? (
                                <>
                                  {Array.from({ length: 8 }).map((_, i) => (
                                    <SkeletonRow key={i} widths={['lg','sm','sm','sm','lg','sm','lg']} />
                                  ))}
                                </>
                            ) : filteredUsers.length === 0 ? (
                                <tr><td colSpan="7" className="text-center p-8 text-gray-500">No users match the current filters.</td></tr>
                            ) : (
                                filteredUsers.map(u => {
                                    const isEditing = editingId === u.id;
                                    const isBusy = busyId === u.id;
                                    const isSelf = me.id === u.id;
                                    const currentManagerId = assignMap[u.id];

                                    return (
                                        <tr key={u.id} className={`border-b hover:bg-gray-50 ${isBusy ? 'opacity-50' : ''}`}>
                                            <td className="px-6 py-4">
                                                {isEditing ? (
                                                    <div className="flex gap-2">
                                                        <input value={editEmail} onChange={e => setEditEmail(e.target.value)} className="p-1 border border-gray-300 rounded-md" />
                                                        <LoadingButton onClick={() => saveEmail(u.id)}>Save</LoadingButton>
                                                        <LoadingButton onClick={() => setEditingId(null)}>Cancel</LoadingButton>
                                                    </div>
                                                ) : (
                                                    <div className="font-medium text-gray-900">
                                                        {u.email}
                                                        {u.meta?.full_name ? <div className="text-xs text-gray-500">{u.meta.full_name}</div> : null}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {isSuperAdmin ? (
                                                  <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} disabled={isBusy || isSelf} className="p-1 border border-gray-300 rounded-md bg-white">
                                                      {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                                                  </select>
                                                ) : (
                                                  <span className="text-gray-800">{String(u.role || '').replace(/_/g, ' ')}</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-xs text-gray-600">
                                               {
                                                 (() => {
                                                   const mid = getManagerIdForUser(u);
                                                   return mid ? (userById[mid]?.email || `ID: ${mid}`) : 'N/A';
                                                 })()
                                               }
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${u.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'}`}>
                                                    {u.active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-gray-600">
                                                {u.last_role_change_at ? new Date(u.last_role_change_at).toLocaleDateString() : '—'}
                                                {u.last_role_changed_by ? (
                                                    <div className="text-[11px] text-gray-500">
                                                        by {userById[u.last_role_changed_by]?.email || `id ${u.last_role_changed_by}`}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="px-6 py-4 text-xs text-gray-500">{new Date(u.updated_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-4">
                                                    <LoadingButton onClick={() => openHistory(u.id)} disabled={isBusy}>Position History</LoadingButton>
                                                    <LoadingButton onClick={() => navigate(`/admin/users/${u.id}`)} disabled={isBusy}>Edit</LoadingButton>
                                                    <LoadingButton onClick={() => toggleActive(u)} disabled={isBusy || isSelf} style={{ color: '#a16207', borderColor: '#a16207' }}>
                                                        {u.active ? 'Deactivate' : 'Activate'}
                                                    </LoadingButton>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Position History Modal */}
                {historyForId !== null && (
                  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
                      <div className="px-5 py-3 border-b flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Position History — User #{historyForId}</h3>
                        <LoadingButton onClick={closeHistory}>Close</LoadingButton>
                      </div>
                      <div className="p-4 max-h-[65vh] overflow-y-auto">
                        {historyLoading ? (
                          <div className="text-gray-500">Loading…</div>
                        ) : historyItems.length === 0 ? (
                          <div className="text-gray-500">No role changes found for this user.</div>
                        ) : (
                          <ul className="divide-y">
                            {historyItems.map(item => (
                              <li key={item.id} className="py-2 text-sm">
                                <div className="text-gray-800">
                                  {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                                </div>
                                <div className="text-gray-600">
                                  Changed by: {userById[item.changed_by]?.email || `id ${item.changed_by}`}
                                </div>
                                <div className="text-gray-500">
                                  {String(item._fromRole || '').replace(/_/g,' ') || 'unknown'} → {String(item._toRole || '').replace(/_/g,' ')}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="px-5 py-3 border-t text-right">
                        <LoadingButton onClick={closeHistory} variant="primary">Close</LoadingButton>
                      </div>
                    </div>
                  </div>
                )}
            </main>
        </div>
    );
}
