import React, { useEffect, useState } from 'react'
import { fetchWithAuth } from '../lib/apiClient.js'
import { calculateForUnit } from '../services/calculatorApi.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export default function TypeAndUnitPicker({
  styles,
  mode,
  inputs,
  unitInfo,
  setUnitInfo,
  setStdPlan,
  setInputs,
  setCurrency,
  setFeeSchedule,
  setUnitPricingBreakdown
}) {
  const [types, setTypes] = useState([])
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [units, setUnits] = useState([])
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [loadingUnits, setLoadingUnits] = useState(false)

  useEffect(() => {
    const loadTypes = async () => {
      try {
        setLoadingTypes(true)
        const resp = await fetchWithAuth(`${API_URL}/api/inventory/types`)
        const data = await resp.json()
        if (resp.ok) setTypes(data.unit_types || [])
      } finally {
        setLoadingTypes(false)
      }
    }
    loadTypes()
  }, [])

  useEffect(() => {
    const loadUnits = async () => {
      if (!selectedTypeId) { setUnits([]); return }
      try {
        setLoadingUnits(true)
        const resp = await fetchWithAuth(`${API_URL}/api/inventory/units?unit_type_id=${encodeURIComponent(selectedTypeId)}`)
        const data = await resp.json()
        if (resp.ok) setUnits(data.units || [])
      } finally {
        setLoadingUnits(false)
      }
    }
    loadUnits()
  }, [selectedTypeId])

  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
      <div>
        <select value={selectedTypeId} onChange={e => setSelectedTypeId(e.target.value)} style={styles.select()}>
          <option value="">Select type…</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {loadingTypes ? <small style={{ color: '#6b7280', fontSize: 12 }}>Loading types…</small> : null}
      </div>
      <div>
        <select
          value=""
          onChange={async e => {
            const id = Number(e.target.value)
            const u = units.find(x => x.id === id)
            if (!u) return
            // Compute total price excluding maintenance (PV base)
            const base = Number(u.base_price || 0)
            const garden = Number(u.garden_price || 0)
            const roof = Number(u.roof_price || 0)
            const storage = Number(u.storage_price || 0)
            const garage = Number(u.garage_price || 0)
            const maintenance = Number(u.maintenance_price || 0)
            const total = base + garden + roof + storage + garage

            setStdPlan(s => ({ ...s, totalPrice: total }))
            setCurrency(u.currency || 'EGP')
            setUnitInfo(s => ({
              ...s,
              unit_type: u.unit_type || s.unit_type,
              unit_code: u.code || s.unit_code,
              unit_number: s.unit_number,
              unit_id: u.id
            }))
            if (setFeeSchedule) {
              setFeeSchedule(fs => ({
                ...fs,
                maintenancePaymentAmount: maintenance || ''
              }))
            }
            if (setUnitPricingBreakdown) {
              setUnitPricingBreakdown({
                base, garden, roof, storage, garage, maintenance,
                totalExclMaintenance: total
              })
            }
            // Pull standard financials for this unit via approved standard (server will resolve from unitId)
            try {
              await calculateForUnit({
                mode,
                unitId: Number(u.id),
                inputs: {
                  salesDiscountPercent: Number(inputs.salesDiscountPercent) || 0,
                  dpType: inputs.dpType || 'percentage',
                  downPaymentValue: Number(inputs.downPaymentValue) || 20,
                  planDurationYears: Number(inputs.planDurationYears) || 5,
                  installmentFrequency: inputs.installmentFrequency || 'monthly',
                  additionalHandoverPayment: Number(inputs.additionalHandoverPayment) || 0,
                  handoverYear: Number(inputs.handoverYear) || 2,
                  splitFirstYearPayments: !!inputs.splitFirstYearPayments,
                  firstYearPayments: [],
                  subsequentYears: []
                }
              }, API_URL)
              setInputs(s => ({
                ...s,
                planDurationYears: s.planDurationYears || 5,
                installmentFrequency: s.installmentFrequency || 'monthly',
                dpType: 'percentage',
                downPaymentValue: s.downPaymentValue || 20
              }))
            } catch {
              setInputs(s => ({
                ...s,
                planDurationYears: s.planDurationYears || 5,
                installmentFrequency: s.installmentFrequency || 'monthly',
                dpType: 'percentage',
                downPaymentValue: s.downPaymentValue || 20
              }))
            }
          }}
          style={styles.select()}
          disabled={!selectedTypeId || loadingUnits || units.length === 0}
        >
          <option value="">{loadingUnits ? 'Loading…' : (units.length ? 'Select unit…' : 'No units')}</option>
          {units.map(u => (
            <option key={u.id} value={u.id}>{u.code}</option>
          ))}
        </select>
      </div>
    </div>
  )
}