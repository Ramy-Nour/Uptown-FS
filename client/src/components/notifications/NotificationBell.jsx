import React, { useEffect, useState, useRef } from 'react'
import { fetchWithAuth } from '../../lib/apiClient.js'

export default function NotificationBell() {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  async function loadCount() {
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/notifications/unread-count`)
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) setCount(Number(data?.count || 0))
    } catch {}
  }

  async function loadList() {
    try {
      setLoading(true)
      const resp = await fetchWithAuth(`${API_URL}/api/notifications`)
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) setItems(Array.isArray(data?.notifications) ? data.notifications : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCount()
    const t = setInterval(loadCount, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  async function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      await loadList()
    }
  }

  async function markAllRead() {
    try {
      await fetchWithAuth(`${API_URL}/api/notifications/mark-all-read`, { method: 'PATCH' })
      setItems(it => it.map(n => ({ ...n, read: true })))
      setCount(0)
    } catch {}
  }

  async function markRead(id) {
    try {
      await fetchWithAuth(`${API_URL}/api/notifications/${id}/read`, { method: 'PATCH' })
      setItems(it => it.map(n => n.id === id ? { ...n, read: true } : n))
      setCount(c => Math.max(0, c - 1))
    } catch {}
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={toggleOpen} style={bellBtnStyle} title="Notifications">
        <span>🔔</span>
        {count > 0 && <span style={badgeStyle}>{count}</span>}
      </button>
      {open && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderBottom: '1px solid #e5e7eb' }}>
            <strong>Notifications</strong>
            <button style={linkBtn} onClick={markAllRead}>Mark all read</button>
          </div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {loading && <div style={{ padding: 10, color: '#64748b' }}>Loading…</div>}
            {!loading && items.length === 0 && <div style={{ padding: 10, color: '#64748b' }}>No notifications</div>}
            {!loading && items.map(n => (
              <div key={n.id} style={{ padding: 10, borderBottom: '1px solid #f1f5f9', background: n.read ? '#fff' : '#f9fafb' }}>
                <div style={{ fontSize: 13, color: '#111827' }}>{n.message || n.type}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</div>
                {!n.read && <button style={{ ...linkBtn, marginTop: 6 }} onClick={() => markRead(n.id)}>Mark read</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const bellBtnStyle = {
  position: 'relative',
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.7)',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14
}
const badgeStyle = {
  position: 'absolute',
  top: -6,
  right: -6,
  background: '#dc2626',
  color: '#fff',
  borderRadius: 999,
  padding: '0 6px',
  fontSize: 10,
  lineHeight: '16px',
  height: 16,
  minWidth: 16,
  textAlign: 'center'
}
const panelStyle = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  width: 320,
  background: '#fff',
  color: '#111827',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
  zIndex: 1001
}
const linkBtn = {
  background: 'transparent',
  border: 'none',
  color: '#2563eb',
  cursor: 'pointer',
  fontSize: 12
}