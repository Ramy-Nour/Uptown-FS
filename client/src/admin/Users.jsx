import React, { useEffect, useState } from 'react';
import { fetchWithAuth, API_URL } from '../lib/apiClient';
import BrandHeader from '../lib/BrandHeader';

// --- Main Component ---

export default function Users() {
    // --- State Management ---
    const [users, setUsers] = useState([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [busyId, setBusyId] = useState(null); // Tracks which user row is busy
    const [creating, setCreating] = useState(false);
    
    // Form and filter states
    const [createForm, setCreateForm] = useState({ email: '', password: '', role: 'user' });
    const [editingId, setEditingId] = useState(null);
    const [editEmail, setEditEmail] = useState('');
    const [filters, setFilters] = useState({ status: 'active', role: 'all', search: '' });
    const [assignMap, setAssignMap] = useState({}); // { [userId]: managerId }

    const [me, setMe] = useState(null);

    // --- Data Loading ---
    async function loadData() {
        setIsLoading(true);
        setError('');
        try {
            const [usersResp, memResp, meResp] = await Promise.all([
                fetchWithAuth(`${API_URL}/api/auth/users`),
                fetchWithAuth(`${API_URL}/api/workflow/sales-teams/memberships?active=true`),
                fetchWithAuth(`${API_URL}/api/auth/me`)
            ]);

            if (!usersResp.ok) throw new Error('Failed to load users');
            const usersData = await usersResp.json();
            setUsers(usersData.users || []);

            if (memResp.ok) {
                const memData = await memResp.json();
                if (memData.memberships) {
                    const map = memData.memberships.reduce((acc, m) => {
                        acc[m.consultant_user_id] = String(m.manager_user_id);
                        return acc;
                    }, {});
                    setAssignMap(map);
                }
            }

            if (!meResp.ok) throw new Error('Failed to load current user profile');
            const meData = await meResp.json();
            setMe(meData.user);

        } catch (e) {
            setError(e.message || 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    // --- Event Handlers & Actions ---

    // A generic handler to simplify managing multiple API actions on user rows
    const handleUserAction = async (userId, action) => {
        setBusyId(userId);
        setError('');
        try {
            await action();
            await loadData(); // Reload data on success
        } catch (err) {
            setError(err.message || 'Action failed.');
        } finally {
            setBusyId(null);
        }
    };
    
    const createUser = (e) => {
        e.preventDefault();
        setCreating(true);
        handleUserAction(null, async () => {
            const resp = await fetchWithAuth(`${API_URL}/api/auth/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(createForm),
            });
            if (!resp.ok) {
                const errorData = await resp.json().catch(() => ({ error: { message: 'An unknown error occurred' } }));
                throw new Error(errorData.error?.message || 'Failed to create user');
            }
            await loadData(); // Refresh user list
            setCreateForm({ email: '', password: '', role: 'user' }); // Reset form
        }).finally(() => setCreating(false));
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
        });
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
        });
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
        });
    };

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
        return true;
    });
    
    const managers = users.filter(u => u.role.includes('manager'));
    const userById = Object.fromEntries(users.map(u => [u.id, u]));
    const roleOptions = [...new Set(users.map(u => u.role).concat('user', 'admin', 'superadmin'))].sort();

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
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="role">Role</label>
                            <select id="role" value={createForm.role} onChange={e => setCreateForm(s => ({ ...s, role: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg">
                                {roleOptions.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                            </select>
                        </div>
                        <button type="submit" disabled={creating} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-blue-300">
                            {creating ? 'Creating...' : 'Create User'}
                        </button>
                    </form>
                </div>

                {/* Filters */}
                <div className="bg-white p-4 rounded-lg shadow-sm mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input type="text" placeholder="Search by email or notes..." value={filters.search} onChange={e => setFilters(s => ({ ...s, search: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg" />
                    <select value={filters.role} onChange={e => setFilters(s => ({ ...s, role: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg">
                        <option value="all">All Roles</option>
                        {roleOptions.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                    <select value={filters.status} onChange={e => setFilters(s => ({ ...s, status: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-lg">
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="all">All Statuses</option>
                    </select>
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
                                <th className="px-6 py-3">Last Updated</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading || !me ? (
                                <tr><td colSpan="6" className="text-center p-8 text-gray-500">Loading...</td></tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr><td colSpan="6" className="text-center p-8 text-gray-500">No users match the current filters.</td></tr>
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
                                                        <button onClick={() => saveEmail(u.id)} className="text-blue-600 hover:text-blue-800">Save</button>
                                                        <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-700">Cancel</button>
                                                    </div>
                                                ) : (
                                                    <div className="font-medium text-gray-900">{u.email}</div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} disabled={isBusy || isSelf} className="p-1 border border-gray-300 rounded-md bg-white">
                                                    {roleOptions.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                                                </select>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-gray-600">
                                               {currentManagerId ? (userById[currentManagerId]?.email || `ID: ${currentManagerId}`) : 'N/A'}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${u.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'}`}>
                                                    {u.active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-gray-500">{new Date(u.updated_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-4">
                                                    <button onClick={() => setEditingId(u.id)} disabled={isBusy} className="font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-300">Edit</button>
                                                    <button onClick={() => toggleActive(u)} disabled={isBusy || isSelf} className="font-medium text-yellow-600 hover:text-yellow-800 disabled:text-gray-300">
                                                        {u.active ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
}
