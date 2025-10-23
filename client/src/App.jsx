import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { fetchWithAuth } from './lib/apiClient.js'
import BrandHeader from './lib/BrandHeader.jsx'
import { getArabicMonth, t, isRTL, applyDocumentDirection } from './lib/i18n.js'
import numberToArabic from './lib/numberToArabic.js'
import EvaluationPanel from './components/calculator/EvaluationPanel.jsx'
import PaymentSchedule from './components/calculator/PaymentSchedule.jsx'
import ClientInfoForm from './components/calculator/ClientInfoFormMin.jsx'
import UnitInfoSection from './components/calculator/UnitInfoSection.jsx'
import ContractDetailsForm from './components/calculator/ContractDetailsForm.jsx'
import InputsForm from './components/calculator/InputsForm.jsx'
import LoadingButton from './components/LoadingButton.jsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const LS_KEY = 'uptown_calc_form_state_v2'

const styles = {
  page: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    background: '#f7f6f3',
    minHeight: '100vh',
    color: '#222'
  },
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px 20px 48px'
  },
  header: {
    background: '#fff',
    border: '1px solid #ead9bd',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 2px 6px rgba(169, 126, 52, 0.08)'
  },
  h1: { margin: 0, fontSize: 22, fontWeight: 700, color: '#A97E34' },
  sub: { color: '#6b7280', marginTop: 6, fontSize: 13 },
  section: {
    background: '#fff',
    border: '1px solid #ead9bd',
    borderRadius: 12,
    padding: 20,
    marginTop: 16,
    boxShadow: '0 2px 6px rgba(169, 126, 52, 0.06)'
  },
  sectionTitle: { margin: '0 0 12px 0', fontSize: 18, fontWeight: 700, color: '#A97E34' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  blockFull: { gridColumn: '1 / span 2' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#4b5563', marginBottom: 6 },
  input: (err) => ({
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${err ? '#e11d48' : '#ead9bd'}`,
    outline: 'none',
    width: '100%',
    fontSize: 14,
    background: '#fbfaf7'
  }),
  select: (err) => ({
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${err ? '#e11d48' : '#ead9bd'}`,
    outline: 'none',
    width: '100%',
    fontSize: 14,
    background: '#fbfaf7'
  }),
  textarea: (err) => ({
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${err ? '#e11d48' : '#ead9bd'}`,
    outline: 'none',
    width: '100%',
    fontSize: 14,
    background: '#fbfaf7',
    minHeight: 80,
    resize: 'vertical'
  }),
  metaText: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #ead9bd',
    background: '#fff',
    color: '#111827',
    cursor: 'pointer'
  },
  btnPrimary: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #A97E34',
    background: '#A97E34',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600
  },
  tableWrap: {
    maxWidth: 1200,
    overflow: 'auto',
    border: '1px solid #ead9bd',
    borderRadius: 12
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: 12, borderBottom: '1px solid #ead9bd', fontSize: 13, color: '#5b4630', background: '#f6efe3' },
  td: { padding: 12, borderBottom: '1px solid #f2e8d6', fontSize: 14 },
  tFootCell: { padding: 12, fontWeight: 700, background: '#fbfaf7' },
  error: { color: '#e11d48' }
}

function DiscountHint({ role, value }) {
  const v = Number(value) || 0
  const noteStyle = { color: '#6b7280', fontSize: 12, marginTop: 4 }
  if (!role) return null
  if (role === 'property_consultant') {
    if (v <= 2) return <div style={noteStyle}>Within sales consultant authority. Sales manager review required.</div>
    return <div style={{ ...noteStyle, color: '#b45309' }}>Exceeds 2%. Not permitted for sales consultant.</div>
  }
  if (role === 'sales_manager') {
    if (v <= 2) return <div style={noteStyle}>Within sales consultant/sales manager authority.</div>
    return <div style={{ ...noteStyle, color: '#b45309' }}>Over 2% requires escalation to Financial Manager and CEO.</div>
  }
  if (role === 'financial_manager') {
    if (v <= 2) return <div style={noteStyle}>Within 2% band.</div>
    if (v > 2 && v <= 5) return <div style={{ ...noteStyle, color: '#b45309' }}>Selected discount requires CEO approval.</div>
    return <div style={{ ...noteStyle, color: '#e11d48' }}>Exceeds 5%. Not permitted.</div>
  }
  return null
}

export default function App(props) {
  const embedded = !!(props && props.embedded)
  const [message, setMessage] = useState('Loading...')
  const [health, setHealth] = useState(null)

  // Inline validation state
  const [errors, setErrors] = useState({})

  // Custom form state
  const [mode, setMode] = useState('evaluateCustomPrice')
  const [language, setLanguage] = useState('en')
  const [currency, setCurrency] = useState('EGP')
  const [stdPlan, setStdPlan] = useState({
    totalPrice: 1000000,
    financialDiscountRate: 12,
    calculatedPV: 850000
  })
  const [inputs, setInputs] = useState({
    salesDiscountPercent: 1.5,
    dpType: 'amount',
    downPaymentValue: 100000,
    planDurationYears: 5,
    installmentFrequency: 'monthly',
    additionalHandoverPayment: 0,
    handoverYear: 2,
    splitFirstYearPayments: false,
    offerDate: new Date().toISOString().slice(0, 10),
    firstPaymentDate: new Date().toISOString().slice(0, 10)
  })

  // Apply document dir/lang whenever language changes
  useEffect(() => {
    applyDocumentDirection(language)
  }, [language])

  // When switching into PV-target modes, convert DP% to a fixed amount once.
  // This avoids the pitfall where a user had 20% and it becomes the literal amount "20"
  // leading to an unrealistically low solved total.
  useEffect(() => {
    if (mode === 'calculateForTargetPV' || mode === 'customYearlyThenEqual_targetPV') {
      setInputs(s => {
        if (s.dpType === 'amount') return s
        const dpPct = Number(s.downPaymentValue) || 0
        const base = Number(stdPlan.totalPrice) || 0
        const dpAmt = base > 0 ? (base * dpPct) / 100 : 0
        return { ...s, dpType: 'amount', downPaymentValue: Number(dpAmt.toFixed(2)) }
      })
    }
  }, [mode, stdPlan.totalPrice])

  // Auto-compute Standard Calculated PV from Standard Total Price, Financial Rate, Duration and Frequency
  // IMPORTANT:
  // - When a unit is selected (server-approved standard), we rely on the server-computed PV and do NOT overwrite it here.
  // - We mark that state with stdPlan._serverLocked = true.
  useEffect(() => {
    // Skip client-side recompute when server-provided baseline is locked
    if (stdPlan && stdPlan._serverLocked) return

    const total = Number(stdPlan.totalPrice) || 0
    const rateAnnual = Number(stdPlan.financialDiscountRate) || 0
    const years = Number(inputs.planDurationYears) || 0
    const freq = String(inputs.installmentFrequency || 'monthly')

    if (!(total > 0) || !(years > 0)) return

    // Convert annual percent to monthly effective
    const monthlyRate = rateAnnual > 0 ? Math.pow(1 + rateAnnual / 100, 1 / 12) - 1 : 0

    // Payments per year
    let perYear = 12
    switch (freq) {
      case 'quarterly': perYear = 4; break
      case 'bi-annually': perYear = 2; break
      case 'annually': perYear = 1; break
      case 'monthly':
      default: perYear = 12; break
    }
    const n = years * perYear
    if (n <= 0) return

    // Equal installments baseline for the standard plan
    const perPayment = total / n

    // Month offsets start at 1, spaced by 12/perYear months
    const months = []
    const step = Math.round(12 / perYear)
    for (let i = 0; i < n; i++) {
      const m = (i === 0) ? step : (months[i - 1] + step)
      months.push(m)
    }

    let pv = 0
    if (monthlyRate <= 0) {
      pv = perPayment * n
    } else {
      for (const m of months) {
        pv += perPayment / Math.pow(1 + monthlyRate, m)
      }
    }

    // Only update if it actually changed (avoid re-renders loops due to float jitter)
    const nextPV = Number(pv.toFixed(2))
    const currentPV = Number((Number(stdPlan.calculatedPV) || 0).toFixed(2))
    if (Number.isFinite(nextPV) && nextPV > 0 && Math.abs(nextPV - currentPV) > 0.01) {
      setStdPlan(s => ({ ...s, calculatedPV: nextPV }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdPlan.totalPrice, stdPlan.financialDiscountRate, inputs.planDurationYears, inputs.installmentFrequency, stdPlan._serverLocked])

  // Current user (for role-based UI and hints)
  const [authUser, setAuthUser] = useState(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('auth_user')
      if (raw) setAuthUser(JSON.parse(raw))
    } catch {}
  }, [])
  const role = authUser?.role

  // Lock certain fields when a unit is selected (use server-approved standard)

  // Dynamic arrays
  const [firstYearPayments, setFirstYearPayments] = useState([])
  const [subsequentYears, setSubsequentYears] = useState([])

  // New Sections state
  const [clientInfo, setClientInfo] = useState({
    buyer_name: '',
    nationality: '',
    id_or_passport: '',
    id_issue_date: '',
    birth_date: '',
    address: '',
    phone_primary: '',
    phone_secondary: '',
    email: ''
  })
  const [unitInfo, setUnitInfo] = useState({
    unit_type: '',
    unit_code: '',
    description: '',
    unit_number: '',
    floor: '',
    building_number: '',
    block_sector: '',
    zone: '',
    garden_details: ''
  })
  // Now that unitInfo is initialized, compute rateLocked
  const rateLocked = Number(unitInfo?.unit_id) > 0
  const [unitPricingBreakdown, setUnitPricingBreakdown] = useState({
    base: 0,
    garden: 0,
    roof: 0,
    storage: 0,
    garage: 0,
    maintenance: 0,
    totalExclMaintenance: 0
  })
  // Units catalog (typeahead)
  const [unitsCatalog, setUnitsCatalog] = useState([])
  const [unitQuery, setUnitQuery] = useState('')
  const [unitSearchLoading, setUnitSearchLoading] = useState(false)
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false)
  const [contractInfo, setContractInfo] = useState({
    reservation_form_date: '',
    contract_date: '',
    reservation_payment_amount: '',
    reservation_payment_date: '',
    maintenance_fee: '',
    delivery_period: ''
  })

  // Additional fees schedule (not part of PV calc)
  const [feeSchedule, setFeeSchedule] = useState({
    maintenancePaymentAmount: '',
    maintenancePaymentMonth: '',
    garagePaymentAmount: '',
    garagePaymentMonth: ''
  })
  const [customNotes, setCustomNotes] = useState({
    dp_explanation: '',
    poa_clause: ''
  })

  // Live preview result
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const debounceTimer = useRef(null)

  // Generate-plan result
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState('')
  const [genResult, setGenResult] = useState(null)

  // Document generation state
  const [docLoading, setDocLoading] = useState(false)
  const [docError, setDocError] = useState('')
  const [docProgress, setDocProgress] = useState(0)
  const docProgressTimer = useRef(null)

  // Centrally-managed acceptance thresholds (TM-approved, loaded from API)
  const [thresholdsCfg, setThresholdsCfg] = useState({})
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const resp = await fetchWithAuth(`${API_URL}/api/config/acceptance-thresholds`)
        const data = await resp.json()
        if (mounted && resp.ok) {
          setThresholdsCfg(data.thresholds || {})
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  // Load persisted state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved) {
          if (saved.mode) setMode(saved.mode)
          if (saved.language) setLanguage(saved.language)
          if (saved.currency) setCurrency(saved.currency)
          if (saved.stdPlan) setStdPlan(saved.stdPlan)
          if (saved.inputs) setInputs(saved.inputs)
          if (Array.isArray(saved.firstYearPayments)) setFirstYearPayments(saved.firstYearPayments)
          if (Array.isArray(saved.subsequentYears)) setSubsequentYears(saved.subsequentYears)
          if (saved.clientInfo) setClientInfo(saved.clientInfo)
          if (saved.unitInfo) setUnitInfo(saved.unitInfo)
          if (saved.contractInfo) setContractInfo(saved.contractInfo)
          if (saved.customNotes) setCustomNotes(saved.customNotes)
        }
      }
    } catch {}
  }, [])

  // Typeahead: search units on query change (debounced)
  useEffect(() => {
    let t = null
    const run = async () => {
      const q = unitQuery.trim()
      if (!q) {
        setUnitsCatalog([])
        return
      }
      try {
        setUnitSearchLoading(true)
        const resp = await fetchWithAuth(`${API_URL}/api/units?search=${encodeURIComponent(q)}&page=1&pageSize=20`)
        const data = await resp.json()
        if (resp.ok) {
          setUnitsCatalog(data.units || [])
          setUnitDropdownOpen(true)
        }
      } catch {
        // ignore
      } finally {
        setUnitSearchLoading(false)
      }
    }
    t = setTimeout(run, 300)
    return () => t && clearTimeout(t)
  }, [unitQuery])

  // Load global Standard Plan on mount to populate rate/duration/frequency for consultants
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const resp = await fetchWithAuth(`${API_URL}/api/standard-plan/latest`)
        const data = await resp.json()
        if (!mounted || !resp.ok) return
        const sp = data?.standardPlan
        if (sp) {
          setStdPlan(s => ({
            ...s,
            financialDiscountRate: Number(sp.std_financial_rate_percent) || s.financialDiscountRate
          }))
          setInputs(s => ({
            ...s,
            planDurationYears: s.planDurationYears || Number(sp.plan_duration_years) || 5,
            installmentFrequency: s.installmentFrequency || sp.installment_frequency || 'monthly'
          }))
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

    // When we have a selected unit_id, retrieve authoritative Standard PV from the server
    // and lock it to avoid client-side recomputation drifting from Financial Manager logs.
    useEffect(() => {
      const uid = Number(unitInfo.unit_id)
      if (!Number.isFinite(uid) || uid <= 0) return
      let abort = false
      async function loadStdFromServer() {
        try {
          // Use generate-plan because it returns evaluation.pv.standardPV and meta.rateUsedPercent
          const resp = await fetchWithAuth(`${API_URL}/api/generate-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: mode || 'evaluateCustomPrice',
              unitId: uid,
              language,
              currency,
              inputs: {
                salesDiscountPercent: Number(inputs.salesDiscountPercent) || 0,
                // dpType value is irrelevant for baseline PV; include to satisfy validation
                dpType: 'amount',
                downPaymentValue: Number(inputs.downPaymentValue) || 0,
                planDurationYears: Number(inputs.planDurationYears) || 5,
                installmentFrequency: inputs.installmentFrequency || 'monthly',
                additionalHandoverPayment: Number(inputs.additionalHandoverPayment) || 0,
                handoverYear: Number(inputs.handoverYear) || 2,
                splitFirstYearPayments: !!inputs.splitFirstYearPayments,
                firstYearPayments: [],
                subsequentYears: [],
                baseDate: inputs.firstPaymentDate || inputs.offerDate || new Date().toISOString().slice(0, 10)
              }
            })
          })
          const data = await resp.json().catch(() => null)
          if (!resp.ok || !data) return
          if (abort) return
          const serverStdPV = Number(data?.evaluation?.pv?.standardPV) || null
          const rateUsed = Number(data?.meta?.rateUsedPercent)
          if (serverStdPV && serverStdPV > 0) {
            setStdPlan(s => ({
              ...s,
              calculatedPV: Number(serverStdPV.toFixed(2)),
              // If API reported the rate used, adopt it
              financialDiscountRate: Number.isFinite(rateUsed) && rateUsed >= 0 ? rateUsed : s.financialDiscountRate,
              _serverLocked: true
            }))
          } else {
            // If server didn't return the PV (unexpected), ensure we don't falsely lock
            setStdPlan(s => ({ ...s, _serverLocked: false }))
          }
        } catch {
          // keep current values
        }
      }
      loadStdFromServer()
      return () => { abort = true }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unitInfo.unit_id])

  function TypeAndUnitPicker({ unitInfo, setUnitInfo, setStdPlan, setInputs, setCurrency, setFeeSchedule, setUnitPricingBreakdown }) {
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
          {loadingTypes ? <small style={styles.metaText}>Loading types…</small> : null}
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
                  maintenancePaymentAmount: maintenance || '',
                  // leave months empty for consultant to choose
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
                // Use calculate with unitId to cause server to load approved standard and suggest defaults
                const resp = await fetchWithAuth(`${API_URL}/api/calculate`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
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
                  })
                })
                // Even if this call fails, we keep sensible defaults below
                await resp.json().catch(() => ({}))
                // Defaults used when server does not return explicit std values
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

  // Persist on change
  useEffect(() => {
    const snapshot = { mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes, feeSchedule }
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot))
  }, [mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes, feeSchedule])

  // Expose imperative APIs for embedding contexts
  useEffect(() => {
    const getSnapshot = () => {
      const base = {
        mode,
        language,
        currency,
        stdPlan,
        inputs,
        firstYearPayments,
        subsequentYears,
        clientInfo,
        unitInfo,
        contractInfo,
        customNotes
      }
      const payload = buildPayload()
      const out = {
        ...base,
        payload,
        generatedPlan: genResult || null,
        preview
      }
      return out
    }
    const applyClientInfo = (partial) => {
      if (!partial || typeof partial !== 'object') return
      setClientInfo(s => ({
        ...s,
        ...partial
      }))
    }
    const applyUnitInfo = (partial) => {
      if (!partial || typeof partial !== 'object') return
      setUnitInfo(s => ({
        ...s,
        ...partial
      }))
    }
    const applyUnitPrefill = (payload) => {
      if (!payload || typeof payload !== 'object') return
      const { unitInfo: ui, stdPlan: sp, unitPricingBreakdown: upb, currency: curr } = payload
      if (ui && typeof ui === 'object') {
        setUnitInfo(s => ({ ...s, ...ui }))
      }
      if (sp && typeof sp === 'object') {
        setStdPlan(s => ({ ...s, ...sp }))
      }
      if (upb && typeof upb === 'object') {
        setUnitPricingBreakdown({ ...upb })
        // Auto-fill Maintenance Deposit amount in the fee schedule from unit/model pricing
        const maint = Number(upb.maintenance || 0)
        setFeeSchedule(fs => ({ ...fs, maintenancePaymentAmount: maint }))
      }
      if (curr) {
        setCurrency(curr)
      }
    }
    window.__uptown_calc_getSnapshot = getSnapshot
    window.__uptown_calc_applyClientInfo = applyClientInfo
    window.__uptown_calc_applyUnitInfo = applyUnitInfo
    window.__uptown_calc_applyUnitPrefill = applyUnitPrefill
    return () => {
      if (window.__uptown_calc_getSnapshot === getSnapshot) {
        delete window.__uptown_calc_getSnapshot
      }
      if (window.__uptown_calc_applyClientInfo === applyClientInfo) {
        delete window.__uptown_calc_applyClientInfo
      }
      if (window.__uptown_calc_applyUnitInfo === applyUnitInfo) {
        delete window.__uptown_calc_applyUnitInfo
      }
      if (window.__uptown_calc_applyUnitPrefill === applyUnitPrefill) {
        delete window.__uptown_calc_applyUnitPrefill
      }
    }
  }, [mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes, genResult, preview])

  // Initial health check
  useEffect(() => {
    async function load() {
      try {
        const [healthRes, msgRes] = await Promise.all([
          fetchWithAuth(`${API_URL}/api/health`).then(r => r.json()),
          fetchWithAuth(`${API_URL}/api/message`).then(r => r.json())
        ])
        setHealth(healthRes)
        setMessage(msgRes.message)
      } catch (err) {
        setMessage('Failed to reach API. Is Docker running?')
      }
    }
    load()
  }, [])

  function buildPayload() {
    return {
      mode,
      // Pass unitId so server can load approved standard for this unit for comparison
      unitId: Number(unitInfo.unit_id) || undefined,
      stdPlan: {
        totalPrice: Number(stdPlan.totalPrice),
        financialDiscountRate: Number(stdPlan.financialDiscountRate),
        calculatedPV: Number(stdPlan.calculatedPV)
      },
      inputs: {
        salesDiscountPercent: Number(inputs.salesDiscountPercent),
        dpType: inputs.dpType,
        downPaymentValue: Number(inputs.downPaymentValue),
        planDurationYears: Number(inputs.planDurationYears),
        installmentFrequency: inputs.installmentFrequency,
        additionalHandoverPayment: Number(inputs.additionalHandoverPayment),
        handoverYear: Number(inputs.handoverYear),
        splitFirstYearPayments: !!inputs.splitFirstYearPayments,
        firstYearPayments: firstYearPayments.map(p => ({
          amount: Number(p.amount) || 0,
          month: Number(p.month) || 0,
          type: p.type || 'regular'
        })),
        subsequentYears: subsequentYears.map(y => ({
          totalNominal: Number(y.totalNominal) || 0,
          frequency: y.frequency || 'annually'
        }))
      }
    }
  }

  // Client-side inline validation (mirrors server-side constraints)
  function validateForm() {
    const e = {}
    // Ensure offerDate is present; default to today if missing
    const todayStr = new Date().toISOString().slice(0, 10)
    if (!inputs.offerDate) {
      setInputs(s => ({ ...s, offerDate: todayStr }))
    } else {
      // Basic YYYY-MM-DD validation
      const d = new Date(inputs.offerDate)
      const iso = isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''
      if (!iso) {
        e.offerDate = 'Invalid date'
      }
    }
    // Ensure firstPaymentDate is present; default to offerDate or today
    const baseDefault = inputs.offerDate || todayStr
    if (!inputs.firstPaymentDate) {
      setInputs(s => ({ ...s, firstPaymentDate: baseDefault }))
    } else {
      const d = new Date(inputs.firstPaymentDate)
      const iso = isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''
      if (!iso) {
        e.firstPaymentDate = 'Invalid date'
      }
    }

    const payload = buildPayload()
    const { stdPlan: sp, inputs: inp } = payload

    if (!isFinite(sp.totalPrice) || sp.totalPrice < 0) e.std_totalPrice = 'Must be non-negative number'
    if (!isFinite(sp.financialDiscountRate)) e.std_financialDiscountRate = 'Must be a number'
    if (!isFinite(sp.calculatedPV) || sp.calculatedPV < 0) e.std_calculatedPV = 'Must be non-negative number'

    if (!['monthly', 'quarterly', 'bi-annually', 'annually'].includes(inp.installmentFrequency)) {
      e.installmentFrequency = 'Invalid'
    }
    if (!Number.isInteger(inp.planDurationYears) || inp.planDurationYears <= 0) {
      e.planDurationYears = 'Must be integer >= 1'
    }
    if (inp.dpType && !['amount', 'percentage'].includes(inp.dpType)) e.dpType = 'Invalid'
    if (!isFinite(inp.downPaymentValue) || inp.downPaymentValue < 0) e.downPaymentValue = 'Must be non-negative number'
    if (!Number.isInteger(inp.handoverYear) || inp.handoverYear <= 0) e.handoverYear = 'Must be integer >= 1'
    if (!isFinite(inp.additionalHandoverPayment) || inp.additionalHandoverPayment < 0) e.additionalHandoverPayment = 'Must be non-negative number'

    if (inp.splitFirstYearPayments) {
      firstYearPayments.forEach((p, idx) => {
        const keyAmt = `fyp_amount_${idx}`
        const keyMonth = `fyp_month_${idx}`
        if (!isFinite(Number(p.amount)) || Number(p.amount) < 0) e[keyAmt] = '>= 0'
        const m = Number(p.month)
        if (!Number.isInteger(m) || m < 1 || m > 12) e[keyMonth] = '1..12'
      })
    }

    subsequentYears.forEach((y, idx) => {
      const keyTot = `sub_total_${idx}`
      const keyFreq = `sub_freq_${idx}`
      if (!isFinite(Number(y.totalNominal)) || Number(y.totalNominal) < 0) e[keyTot] = '>= 0'
      if (!['monthly', 'quarterly', 'bi-annually', 'annually'].includes(y.frequency)) e[keyFreq] = 'Invalid'
    })

    setErrors(e)
    return { valid: Object.keys(e).length === 0, payload }
  }

  

  async function runGeneratePlan(e) {
    e.preventDefault()
    const { valid, payload } = validateForm()
    if (!valid) {
      setGenError('Please fix validation errors before generating the plan.')
      return
    }
    setGenLoading(true)
    setGenError('')
    setGenResult(null)
    try {
      // Build buyers[] from clientInfo (supports up to 4 buyers via suffixed keys: _2, _3, _4)
      const numBuyersRaw = Number(clientInfo.number_of_buyers)
      const numBuyers = Math.min(Math.max(numBuyersRaw || 1, 1), 4)
      const buyers = []
      for (let i = 1; i <= numBuyers; i++) {
        const sfx = i === 1 ? '' : `_${i}`
        buyers.push({
          buyer_name: clientInfo[`buyer_name${sfx}`] || '',
          nationality: clientInfo[`nationality${sfx}`] || '',
          id_or_passport: clientInfo[`id_or_passport${sfx}`] || '',
          id_issue_date: clientInfo[`id_issue_date${sfx}`] || '',
          birth_date: clientInfo[`birth_date${sfx}`] || '',
          address: clientInfo[`address${sfx}`] || '',
          phone_primary: clientInfo[`phone_primary${sfx}`] || '',
          phone_secondary: clientInfo[`phone_secondary${sfx}`] || '',
          email: clientInfo[`email${sfx}`] || ''
        })
      }

      const body = {
        ...payload,
        language,
        currency,
        buyers,
        // base date for absolute due dates on schedule; require firstPaymentDate (fallback to offerDate or today)
        inputs: {
          ...payload.inputs,
          baseDate: inputs.firstPaymentDate || inputs.offerDate || new Date().toISOString().slice(0, 10),
          maintenancePaymentAmount: Number(feeSchedule.maintenancePaymentAmount) || 0,
          // Optional explicit calendar date for maintenance deposit
          maintenancePaymentDate: feeSchedule.maintenancePaymentDate || '',
          // Default maintenance due at handover when month is empty (ignored if date is provided)
          maintenancePaymentMonth: (() => {
            // Treat empty string as "not provided" so we default to Handover year
            const mRaw = feeSchedule.maintenancePaymentMonth
            const m = Number(mRaw)
            if (mRaw !== '' && Number.isFinite(m) && m >= 0) return m
            const hy = Number(inputs.handoverYear) || 0
            // Default to Handover year in months; if handover not set, use 12 months policy fallback
            return hy > 0 ? hy * 12 : 12
          })(),
          garagePaymentAmount: Number(feeSchedule.garagePaymentAmount) || 0,
          garagePaymentMonth: Number(feeSchedule.garagePaymentMonth) || 0
        }
      }
      const resp = await fetchWithAuth(`${API_URL}/api/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await resp.json()
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Request failed')
      }
      setGenResult(data)
    } catch (e) {
      setGenError(e.message || String(e))
    } finally {
      setGenLoading(false)
    }
  }

  function exportScheduleCSV() {
    if (!genResult?.schedule?.length) return
    const rows = [
      ['#', 'Month', 'Label', 'Amount', 'Written Amount'],
      ...genResult.schedule.map((row, i) => {
        const amt = Number(row.amount || 0)
        const written = (language === 'ar')
          ? numberToArabic(amt, 'جنيه مصري', 'قرش')
          : (row.writtenAmount || '')
        return [
          i + 1,
          row.month,
          row.label,
          amt.toFixed(2),
          written
        ]
      })
    ]
    // Append dual totals
    const totalIncl = Number(((genResult?.totals?.totalNominalIncludingMaintenance ?? genResult?.totals?.totalNominal)) || 0)
    const totalExcl = Number(genResult?.totals?.totalNominalExcludingMaintenance ?? totalIncl)
    rows.push([])
    rows.push([
      '', '', (language === 'ar' ? 'الإجمالي (بدون وديعة الصيانة)' : 'Total (excluding Maintenance Deposit)'),
      totalExcl.toFixed(2),
      ''
    ])
    rows.push([
      '', '', (language === 'ar' ? 'الإجمالي (شامل وديعة الصيانة)' : 'Total (including Maintenance Deposit)'),
      totalIncl.toFixed(2),
      ''
    ])

    const csv = rows.map(r => r.map(cell => {
      const s = String(cell ?? '')
      if (/[\",\n]/.test(s)) return `\"${s.replace(/\"/g, '\"\"')}\"`
      return s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `payment_schedule_${ts}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Build document generation body (includes calculator inputs + plan if available)
  function buildDocumentBody(documentType) {
    const { valid, payload } = validateForm()
    // Even if not valid, we still send what we have; but generally require valid to ensure server accepts

    // Build buyers[] from clientInfo (supports up to 4 buyers via suffixed keys: _2, _3, _4)
    const numBuyersRaw = Number(clientInfo.number_of_buyers)
    const numBuyers = Math.min(Math.max(numBuyersRaw || 1, 1), 4)
    const buyers = []
    for (let i = 1; i <= numBuyers; i++) {
      const sfx = i === 1 ? '' : `_${i}`
      buyers.push({
        buyer_name: clientInfo[`buyer_name${sfx}`] || '',
        nationality: clientInfo[`nationality${sfx}`] || '',
        id_or_passport: clientInfo[`id_or_passport${sfx}`] || '',
        id_issue_date: clientInfo[`id_issue_date${sfx}`] || '',
        birth_date: clientInfo[`birth_date${sfx}`] || '',
        address: clientInfo[`address${sfx}`] || '',
        phone_primary: clientInfo[`phone_primary${sfx}`] || '',
        phone_secondary: clientInfo[`phone_secondary${sfx}`] || '',
        email: clientInfo[`email${sfx}`] || ''
      })
    }

    // Build document data map for placeholders
    const docData = {
      // Primary Client info (English) — Buyer 1
      buyer_name: clientInfo.buyer_name || '',
      nationality: clientInfo.nationality || '',
      id_or_passport: clientInfo.id_or_passport || '',
      id_issue_date: clientInfo.id_issue_date || '',
      birth_date: clientInfo.birth_date || '',
      address: clientInfo.address || '',
      phone_primary: clientInfo.phone_primary || '',
      phone_secondary: clientInfo.phone_secondary || '',
      email: clientInfo.email || '',
      // Dates
      offer_date: inputs.offerDate || new Date().toISOString().slice(0, 10),
      first_payment_date: inputs.firstPaymentDate || inputs.offerDate || new Date().toISOString().slice(0, 10),
      // Client info (Arabic aliases for templates) — Buyer 1
      'اسم المشترى': clientInfo.buyer_name || '',
      'الجنسية': clientInfo.nationality || '',
      'رقم قومي/ رقم جواز': clientInfo.id_or_passport || '',
      'تاريخ الاصدار': clientInfo.id_issue_date || '',
      'تاريخ الميلاد': clientInfo.birth_date || '',
      'العنوان': clientInfo.address || '',
      'رقم الهاتف': clientInfo.phone_primary || '',
      'رقم الهاتف (2)': clientInfo.phone_secondary || '',
      'البريد الالكتروني': clientInfo.email || '',
      // Unit info (English)
      unit_type: unitInfo.unit_type || '',
      unit_code: unitInfo.unit_code || '',
      unit_number: unitInfo.unit_number || '',
      floor: unitInfo.floor || '',
      building_number: unitInfo.building_number || '',
      block_sector: unitInfo.block_sector || '',
      zone: unitInfo.zone || '',
      garden_details: unitInfo.garden_details || '',
      // Unit info (Arabic aliases)
      'نوع الوحدة': unitInfo.unit_type || '',
      'كود الوحدة': unitInfo.unit_code || '',
      'وحدة رقم': unitInfo.unit_number || '',
      'الدور': unitInfo.floor || '',
      'مبنى رقم': unitInfo.building_number || '',
      'قطاع': unitInfo.block_sector || '',
      'مجاورة': unitInfo.zone || '',
      'مساحة الحديقة': unitInfo.garden_details || '',
      // Calculator summaries (optional)
      std_total_price: Number(stdPlan.totalPrice) || 0,
      std_financial_rate_percent: Number(stdPlan.financialDiscountRate) || 0,
      std_calculated_pv: Number(stdPlan.calculatedPV) || 0,
      // Multi-buyer structured data
      buyers
    }

    const body = {
      documentType,
      language,
      currency,
      ...payload,
      data: docData
    }
    // Attach generated plan if available so server can reuse without recalculation (optional)
    if (genResult?.schedule?.length) {
      body.generatedPlan = {
        schedule: genResult.schedule,
        totals: genResult.totals,
        meta: genResult.meta || {}
      }
    }
    return { valid, body }
  }

  async function generateDocument(documentType) {
    const { valid, body } = buildDocumentBody(documentType)
    if (!valid) {
      setDocError('Please fix validation errors before generating the document.')
      return
    }
    setDocLoading(true)
    setDocError('')
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/generate-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        // Try to parse JSON error
        let errMsg = 'Failed to generate document'
        try {
          const j = await resp.json()
          errMsg = j?.error?.message || errMsg
        } catch {}
        throw new Error(errMsg)
      }
      // Expect a file (pdf/docx). Get filename from Content-Disposition if available.
      const blob = await resp.blob()
      const cd = resp.headers.get('Content-Disposition') || ''
      const match = /filename\*=UTF-8''([^;]+)|filename=\\"?([^\\\";]+)\\"?/i.exec(cd)
      let filename = ''
      if (match) {
        filename = decodeURIComponent(match[1] || match[2] || '')
      }
      if (!filename) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        filename = `${documentType}_${ts}.pdf`
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setDocError(e.message || String(e))
    } finally {
      setDocLoading(false)
    }
  }

  async function exportClientOfferPdf() {
    try {
      setDocError('')
      setDocProgress(0)
      setDocLoading(true)
      // Begin indeterminate progress (ramps to 85%)
      if (docProgressTimer.current) {
        clearInterval(docProgressTimer.current)
      }
      docProgressTimer.current = setInterval(() => {
        setDocProgress(p => {
          const next = p + Math.random() * 7
          return next >= 85 ? 85 : next
        })
      }, 350)

      // Build buyers[] from clientInfo (up to 4)
      const numBuyersRaw = Number(clientInfo.number_of_buyers)
      const numBuyers = Math.min(Math.max(numBuyersRaw || 1, 1), 4)
      const buyers = []
      for (let i = 1; i <= numBuyers; i++) {
        const sfx = i === 1 ? '' : `_${i}`
        buyers.push({
          buyer_name: clientInfo[`buyer_name${sfx}`] || '',
          phone_primary: clientInfo[`phone_primary${sfx}`] || '',
          phone_secondary: clientInfo[`phone_secondary${sfx}`] || '',
          email: clientInfo[`email${sfx}`] || ''
        })
      }
      const body = {
        language,
        currency,
        buyers,
        schedule: schedule,
        totals: totals || { totalNominal: (schedule || []).reduce((s, e) => s + (Number(e.amount) || 0), 0) },
        offer_date: inputs.offerDate || new Date().toISOString().slice(0, 10),
        first_payment_date: inputs.firstPaymentDate || inputs.offerDate || new Date().toISOString().slice(0, 10),
        unit: {
          unit_code: unitInfo.unit_code || '',
          unit_type: unitInfo.unit_type || '',
          unit_id: Number(unitInfo.unit_id) || null
        },
        // Include unit pricing breakdown for PDF header box
        unit_pricing_breakdown: {
          base: Number(unitPricingBreakdown.base || 0),
          garden: Number(unitPricingBreakdown.garden || 0),
          roof: Number(unitPricingBreakdown.roof || 0),
          storage: Number(unitPricingBreakdown.storage || 0),
          garage: Number(unitPricingBreakdown.garage || 0),
          maintenance: Number(unitPricingBreakdown.maintenance || 0),
          totalExclMaintenance: Number(unitPricingBreakdown.totalExclMaintenance || 0)
        }
      }
      const resp = await fetchWithAuth(`${API_URL}/api/documents/client-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        let errMsg = 'Failed to generate Client Offer PDF'
        try {
          const j = await resp.json()
          errMsg = j?.error?.message || errMsg
        } catch {}
        throw new Error(errMsg)
      }
      // Nudge progress near completion while reading blob
      setDocProgress(p => Math.max(p, 92))
      const blob = await resp.blob()
      setDocProgress(100)

      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `client_offer_${ts}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setDocError(e.message || String(e))
    } finally {
      setDocLoading(false)
      if (docProgressTimer.current) {
        clearInterval(docProgressTimer.current)
        docProgressTimer.current = null
      }
      setTimeout(() => setDocProgress(0), 800)
    }
  }

  function exportScheduleXLSX() {
    if (!genResult?.schedule?.length) return
    const aoa = [
      ['#', 'Month', 'Label', 'Amount', 'Written Amount'],
      ...genResult.schedule.map((row, i) => {
        const amt = Number(row.amount || 0)
        const written = (language === 'ar')
          ? numberToArabic(amt, 'جنيه مصري', 'قرش')
          : (row.writtenAmount || '')
        return [
          i + 1,
          row.month,
          row.label,
          amt.toFixed(2),
          written
        ]
      })
    ]
    // Append dual totals
    const totalIncl = Number(((genResult?.totals?.totalNominalIncludingMaintenance ?? genResult?.totals?.totalNominal)) || 0)
    const totalExcl = Number(genResult?.totals?.totalNominalExcludingMaintenance ?? totalIncl)
    aoa.push([])
    aoa.push([
      '', '', (language === 'ar' ? 'الإجمالي (بدون وديعة الصيانة)' : 'Total (excluding Maintenance Deposit)'),
      totalExcl.toFixed(2),
      ''
    ])
    aoa.push([
      '', '', (language === 'ar' ? 'الإجمالي (شامل وديعة الصيانة)' : 'Total (including Maintenance Deposit)'),
      totalIncl.toFixed(2),
      ''
    ])

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // Column widths for readability
    ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 28 }, { wch: 16 }, { wch: 50 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `payment_schedule_${ts}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Generate Checks Sheet (formatted for check printing)
  function generateChecksSheetXLSX() {
    if (!genResult?.schedule?.length) return

    const title = 'Checks Sheet'
    const buyer = clientInfo.buyer_name || ''
    const unit = unitInfo.unit_code || unitInfo.unit_number || ''
    const curr = currency || ''

    const headerRows = [
      [title],
      [`Buyer: ${buyer}     Unit: ${unit}     Currency: ${curr}`],
      [], // spacer
      ['#', 'Cheque No.', 'Date', 'Pay To', 'Amount', 'Amount in Words', 'Notes']
    ]

    const bodyRows = genResult.schedule.map((row, i) => {
      const amount = Number(row.amount || 0)
      const amountStr = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      return [
        i + 1,       // #
        '',          // Cheque No. (to be filled manually)
        '',          // Date (to be filled manually)
        buyer,       // Pay To
        amountStr,   // Amount
        row.writtenAmount || '', // Amount in Words
        language === 'ar'
          ? `${row.label} (شهر ${getArabicMonth(row.month)})`
          : `${row.label} (Month ${row.month})` // Notes
      ]
    })

    const aoa = [...headerRows, ...bodyRows]
    const ws = XLSX.utils.aoa_to_sheet(aoa)

    // Set column widths suitable for checks
    ws['!cols'] = [
      { wch: 5 },   // #
      { wch: 14 },  // Cheque No.
      { wch: 14 },  // Date
      { wch: 28 },  // Pay To
      { wch: 16 },  // Amount
      { wch: 60 },  // Amount in Words
      { wch: 30 },  // Notes
    ]

    // Merge title and metadata lines across all columns
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, // A1:G1
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }, // A2:G2
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Checks')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `checks_sheet_${ts}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Computed summaries (from preview)
  const summaries = useMemo(() => {
    if (!preview) return null
    const {
      totalNominalPrice,
      numEqualInstallments,
      equalInstallmentAmount,
      calculatedPV,
      meta
    } = preview
    return {
      totalNominalPrice,
      numEqualInstallments,
      equalInstallmentAmount,
      calculatedPV,
      effectiveStartYears: meta?.effectiveStartYears
    }
  }, [preview])

  // Comparison: Approved Standard PV vs Current Offer PV
  const comparison = useMemo(() => {
    const stdPV = Number(stdPlan.calculatedPV ?? 0)
    const stdRate = Number(stdPlan.financialDiscountRate ?? 0)
    const offerPV = Number((preview && preview.calculatedPV) ?? 0)
    const discountPercent = Number(inputs.salesDiscountPercent ?? 0)
    const deltaPV = offerPV - stdPV
    const deltaPercentPV = stdPV ? (deltaPV / stdPV) * 100 : 0

    // Payment structure metrics (percentages of total nominal)
    const totalsNominal = Number(
      (preview && preview.totalNominalPrice) ??
      (genResult && genResult.totals && genResult.totals.totalNominal) ??
      0
    )

    // First year sum (if split)
    let firstYearNominal = 0
    if (inputs.splitFirstYearPayments) {
      for (const p of (firstYearPayments || [])) {
        firstYearNominal += Number(p?.amount) || 0
      }
    } else {
      // If not split, treat down payment as first-year component for percentage context.
      // When DP is percentage, base it on the CURRENT OFFER total (preview/genResult) not the standard price.
      const offerTotal = Number(
        (preview && preview.totalNominalPrice) ??
        (genResult && genResult.totals && genResult.totals.totalNominal) ??
        0
      ) || 0
      const dpBase = offerTotal > 0 ? offerTotal : (Number(stdPlan.totalPrice) || 0)
      const actualDP = inputs.dpType === 'percentage'
        ? dpBase * ((Number(inputs.downPaymentValue) || 0) / 100)
        : (Number(inputs.downPaymentValue) || 0)
      firstYearNominal = actualDP
    }

    // Subsequent year 1 (Year 2 if split) — take first entry in subsequentYears
    let secondYearNominal = 0
    if (Array.isArray(subsequentYears) && subsequentYears.length > 0) {
      secondYearNominal = Number(subsequentYears[0]?.totalNominal) || 0
    }

    const handoverNominal = Number(inputs.additionalHandoverPayment) || 0

    const pct = (part, total) => {
      const t = Number(total) || 0
      const p = Number(part) || 0
      if (!t || t <= 0) return 0
      return (p / t) * 100
    }

    const firstYearPercent = pct(firstYearNominal, totalsNominal)
    const secondYearPercent = pct(secondYearNominal, totalsNominal)
    const handoverPercent = pct(handoverNominal, totalsNominal)

    // Use centrally-loaded thresholds
    const thresholds = thresholdsCfg || {}
    const check = (value, min, max) => {
      if (min == null && max == null) return null
      if (min != null && Number(value) < Number(min)) return false
      if (max != null && Number(value) > Number(max)) return false
      return true
    }

    const pvPass = Number(offerPV || 0) >= Number(stdPV || 0)
    const fyPass = check(firstYearPercent, thresholds.firstYearPercentMin, thresholds.firstYearPercentMax)
    const syPass = check(secondYearPercent, thresholds.secondYearPercentMin, thresholds.secondYearPercentMax)
    const hoPass = check(handoverPercent, thresholds.handoverPercentMin, thresholds.handoverPercentMax)

    // Overall acceptability: PV must be >= standard AND all defined thresholds must pass
    const overallAcceptable =
      pvPass &&
      (fyPass !== false) &&
      (syPass !== false) &&
      (hoPass !== false)

    return {
      stdPV,
      stdRate,
      offerPV,
      discountPercent,
      deltaPV,
      deltaPercentPV,
      totalsNominal,
      firstYearNominal,
      secondYearNominal,
      handoverNominal,
      firstYearPercent,
      secondYearPercent,
      handoverPercent,
      thresholds,
      firstYearPass: fyPass,
      secondYearPass: syPass,
      handoverPass: hoPass,
      pvPass,
      overallAcceptable
    }
  }, [stdPlan, preview, inputs, firstYearPayments, subsequentYears, genResult, thresholdsCfg])

  // --- Handlers for dynamic arrays ---
  function addFirstYearPayment() {
    setFirstYearPayments(s => [...s, { amount: 0, month: 1, type: 'regular' }])
  }
  function updateFirstYearPayment(index, field, value) {
    setFirstYearPayments(s => {
      const copy = [...s]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }
  function removeFirstYearPayment(index) {
    setFirstYearPayments(s => s.filter((_, i) => i !== index))
  }
  function addSubsequentYear() {
    setSubsequentYears(s => [...s, { totalNominal: 0, frequency: 'annually' }])
  }
  function updateSubsequentYear(index, field, value) {
    setSubsequentYears(s => {
      const copy = [...s]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }
  function removeSubsequentYear(index) {
    setSubsequentYears(s => s.filter((_, i) => i !== index))
  }
  // --- End Handlers ---

  const schedule = genResult?.schedule || []
  const totals = genResult?.totals || null

  // helpers for controlled inputs
  const onChange = (setter) => (e) => setter(e.target.value)

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {!embedded && (
          <div style={{ marginBottom: 16 }}>
            <BrandHeader
              title={import.meta.env.VITE_APP_TITLE || 'Uptown Financial System — Calculator'}
              onLogout={async () => {
                try {
                  const rt = localStorage.getItem('refresh_token')
                  if (rt) {
                    await fetch(`${API_URL}/api/auth/logout`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ refreshToken: rt })
                    }).catch(() => {})
                  }
                } finally {
                  localStorage.removeItem('auth_token')
                  localStorage.removeItem('refresh_token')
                  localStorage.removeItem('auth_user')
                  window.location.href = '/login'
                }
              }}
            />
          </div>
        )}

        

        <InputsForm
          styles={styles}
          language={language}
          setLanguage={setLanguage}
          currency={currency}
          setCurrency={setCurrency}
          mode={mode}
          setMode={setMode}
          stdPlan={stdPlan}
          setStdPlan={setStdPlan}
          inputs={inputs}
          setInputs={setInputs}
          errors={errors}
          unitPricingBreakdown={unitPricingBreakdown}
          rateLocked={rateLocked}
          DiscountHint={DiscountHint}
          summaries={summaries}
          previewError={previewError}
          genLoading={genLoading}
          onGeneratePlan={runGeneratePlan}
          firstYearPayments={firstYearPayments}
          addFirstYearPayment={addFirstYearPayment}
          updateFirstYearPayment={updateFirstYearPayment}
          removeFirstYearPayment={removeFirstYearPayment}
          subsequentYears={subsequentYears}
          addSubsequentYear={addSubsequentYear}
          updateSubsequentYear={updateSubsequentYear}
          removeSubsequentYear={removeSubsequentYear}
          validateForm={validateForm}
          buildPayload={buildPayload}
          setPreview={setPreview}
          setPreviewError={setPreviewError}
          role={role}
          feeSchedule={feeSchedule}
          setFeeSchedule={setFeeSchedule}
        />

        

        {/* Evaluation from server (PV-based decision + five conditions) */}
        {genResult?.evaluation && (
          <section style={styles.section} dir={isRTL(language) ? 'rtl' : 'ltr'}>
            <h2 style={{ ...styles.sectionTitle, textAlign: isRTL(language) ? 'right' : 'left' }}>{t('acceptance_evaluation', language)}</h2>
            <EvaluationPanel evaluation={genResult.evaluation} role={role} dealId={props?.dealId} API_URL={API_URL} />
            <small style={styles.metaText}>
              {/* Keep this note in English for now as it is managerial guidance */}
              Thresholds are set by the Financial Manager and approved by Top Management. The evaluation above is computed server-side.
            </small>
          </section>
        )}

        

        {/* Data Entry UI — New Sections */}
        <ClientInfoForm role={role} clientInfo={clientInfo} setClientInfo={setClientInfo} styles={styles} language={language} />

        {!embedded && (
          <UnitInfoSection
            role={role}
            styles={styles}
            mode={mode}
            inputs={inputs}
            unitInfo={unitInfo}
            setUnitInfo={setUnitInfo}
            setStdPlan={setStdPlan}
            setInputs={setInputs}
            setCurrency={setCurrency}
            setFeeSchedule={setFeeSchedule}
            setUnitPricingBreakdown={setUnitPricingBreakdown}
          />
        )}

        {(role === 'financial_admin' || role === 'financial_manager' || role === 'contract_manager' || role === 'contract_person') && (
          <ContractDetailsForm
            role={role}
            contractInfo={contractInfo}
            setContractInfo={setContractInfo}
            feeSchedule={feeSchedule}
            setFeeSchedule={setFeeSchedule}
            styles={styles}
          />
        )}

        {(role === 'contract_manager' || role === 'contract_person') && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Custom Text Notes</h2>
            <div>
              <label style={styles.label}>Down Payment Explanation (<span style={styles.arInline}>[[بيان الباقي من دفعة التعاقد]]</span>)</label>
              <textarea dir="auto" style={styles.textarea()} value={customNotes.dp_explanation} onChange={e => setCustomNotes(s => ({ ...s, dp_explanation: e.target.value }))} placeholder='مثال: "يسدد الباقي على شيكين"' />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={styles.label}>Power of Attorney Clause (<span style={styles.arInline}>[[بيان التوكيل]]</span>)</label>
              <textarea style={styles.textarea()} value={customNotes.poa_clause} onChange={e => setCustomNotes(s => ({ ...s, poa_clause: e.target.value }))} placeholder='بنود قانونية خاصة إن وجدت' />
            </div>
          </section>
        )}

        {/* Results Table */}
        <section style={styles.section} dir={isRTL(language) ? 'rtl' : 'ltr'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ ...styles.sectionTitle, textAlign: isRTL(language) ? 'right' : 'left' }}>{t('payment_schedule', language)}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* Client Offer PDF — Property Consultant only */}
              {authUser?.role === 'property_consultant' && (
                <>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <LoadingButton
                      variant="primary"
                      loading={docLoading}
                      onClick={exportClientOfferPdf}
                      style={{ ...(styles.btnPrimary || {}), minWidth: 220 }}
                    >
                      {isRTL(language) ? 'تصدير عرض العميل (PDF)' : 'Export Client Offer (PDF)'}
                    </LoadingButton>
                    {docLoading && (
                      <div style={{ width: 160 }}>
                        <div style={{ height: 6, background: '#ead9bd', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, Math.max(0, Math.round(docProgress)))}%`, height: '100%', background: '#A97E34', transition: 'width 300ms ease' }} />
                        </div>
                        <small style={{ color: '#6b7280' }}>{Math.round(docProgress)}%</small>
                      </div>
                    )}
                  </span>
                </>
              )}
              {/* Reservation Form — Financial Admin only */}
              {authUser?.role === 'financial_admin' && (
                <button
                  type="button"
                  onClick={() => generateDocument('reservation_form')}
                  style={styles.btnPrimary}
                >
                  {t('generate_reservation_form', language)}
                </button>
              )}
              {/* Contract — Contract Person only */}
              {authUser?.role === 'contract_person' && (
                <button
                  type="button"
                  onClick={() => generateDocument('contract')}
                  style={styles.btnPrimary}
                >
                  {t('generate_contract', language)}
                </button>
              )}
              {/* Exports (CSV/XLSX/Checks) — Financial Admin only */}
              {authUser?.role === 'financial_admin' && (
                <>
                  <button type="button" onClick={exportScheduleXLSX} disabled={!schedule.length} style={styles.btn}>
                    {t('export_xlsx', language)}
                  </button>
                  <button type="button" onClick={generateChecksSheetXLSX} disabled={!schedule.length} style={styles.btn}>
                    {t('generate_checks_sheet', language)}
                  </button>
                  <button type="button" onClick={exportScheduleCSV} disabled={!schedule.length} style={styles.btn}>
                    {t('export_csv', language)}
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Policy banner: require per-pricing financial settings for unit/model flows */}
          {(() => {
            const uid = Number(unitInfo?.unit_id) || 0;
            const needsPerPricing = uid > 0 && typeof genError === 'string' && genError.toLowerCase().includes('per-pricing financial settings are required');
            if (!needsPerPricing) return null;
            return (
              <div style={{ border: '1px solid #dc2626', background: '#fff4f4', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 8 }}>
                Per-pricing financial settings are required for this unit/model. Please ensure the Financial Manager has configured and Top Management has approved:
                {' '}Annual Financial Rate (%), Plan Duration (years), and Installment Frequency in Standard Pricing for this unit model.
              </div>
            );
          })()}
          {genError ? <p style={styles.error}>{genError}</p> : null}
          {docError ? <p style={styles.error}>{docError}</p> : null}
          {/* Dates summary above schedule for visibility */}
          <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: '#fbfaf7', border: '1px solid #ead9bd', display: 'inline-flex', gap: 16, flexWrap: 'wrap' }}>
            <div><strong>{t('offer_date_short', language)}</strong> {inputs.offerDate || new Date().toISOString().slice(0, 10)}</div>
            <div><strong>{t('first_payment_date_short', language)}</strong> {inputs.firstPaymentDate || inputs.offerDate || new Date().toISOString().slice(0, 10)}</div>
          </div>
          {schedule.length === 0 ? (
            <p style={styles.metaText}>{t('no_schedule_yet', language)}</p>
          ) : (
            <PaymentSchedule
              schedule={schedule}
              totals={totals}
              language={language}
              onExportCSV={exportScheduleCSV}
              onExportXLSX={exportScheduleXLSX}
              onGenerateChecks={generateChecksSheetXLSX}
              role={role}
            />
          )}
        </section>
      {/* Move Unit Block/Unit Info section to the end of the page to reduce streaming contention */}
        {!embedded && (
          <UnitInfoSection
            role={role}
            styles={styles}
            mode={mode}
            inputs={inputs}
            unitInfo={unitInfo}
            setUnitInfo={setUnitInfo}
            setStdPlan={setStdPlan}
            setInputs={setInputs}
            setCurrency={setCurrency}
            setFeeSchedule={setFeeSchedule}
            setUnitPricingBreakdown={setUnitPricingBreakdown}
          />
        )}
      </div>
    </div>
  )
}