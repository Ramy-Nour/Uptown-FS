import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { useNavigate } from 'react-router-dom'
import UnitDetailsTable from '../components/UnitDetailsTable.jsx'
import { UnitCardsGrid } from '../components/UnitDetailsCard.jsx'

export default function InventoryList() {
  const navigate = useNavigate()
  const [units, setUnits] = useState([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeId, setTypeId] = useState('')
  const [types, setTypes] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [layout, setLayout] = useState('table') // 'table' | 'grid'

  useEffect(() => {
    async function loadTypes() {
      try {
        const resp = await fetchWithAuth(`${API_URL}/api/inventory/types`)
        const data = await resp.json()
        if (resp.ok) setTypes(data.unit_types || [])
      } catch {}
    }
    loadTypes()
  }, [])

  async function load(p = 1) {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      if (search) q.set('search', search)
      if (typeId) q.set('unit_type_id', typeId)
      q.set('page', String(p))
      q.set('pageSize', String(pageSize))
      // Sales roles will see only AVAILABLE + unblocked units via server-side filters
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load inventory')
      setUnits(data.units || [])
      setTotal(data.pagination?.total || 0)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeId, pageSize])

  useEffect(() => {
    load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Inventory</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => navigate('/deals/create')} style={btnPrimary}>Go to Calculator</button>
          <div style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
            <button onClick={() => setLayout('table')} style={{ ...btn, ...(layout === 'table' ? { background: '#f9fbfd' } : {}) }}>Table</button>
            <button onClick={() => setLayout('grid')} style={{ ...btn, ...(layout === 'grid' ? { background: '#f9fbfd' } : {}) }}>Grid</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 12, gridTemplateColumns: '1fr 1fr 1fr 1fr auto' }}>
        <input placeholder="Search code/description…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} style={ctrl} />
        <select value={typeId} onChange={e => { setTypeId(e.target.value); setPage(1) }} style={ctrl}>
          <option value="">All types</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }} style={ctrl}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
        <button onClick={() => load(1)} disabled={loading} style={btn}>Refresh</button>
      </div>

      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      {layout === 'table' ? (
        <UnitDetailsTable
          units={units}
          loading={loading}
          onCreateOffer={(u) => navigate(`/deals/create?unit_id=${u.id}`)}
          styles={{ th, td, btn }}
        />
      ) : (
        <UnitCardsGrid
          units={units}
          onCreateOffer={(u) => navigate(`/deals/create?unit_id=${u.id}`)}
        />
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          Page {page} of {totalPages} — {total} total
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setPage(1)} disabled={page === 1} style={btn}>First</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={btn}>Prev</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={btn}>Next</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages} style={btn}>Last</button>
        </div>
      </div>
    </div>
  )
}

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const ctrl = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6' }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }
const btnPrimary = { padding: '10px 14px', borderRadius: 10, border: '1px solid #A97E34', background: '#A97E34', color: '#fff', fontWeight: 600 }