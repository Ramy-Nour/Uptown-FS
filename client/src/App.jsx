import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchWithAuth } from './lib/apiClient.js'
import BrandHeader from './lib/BrandHeader.jsx'
import { t, isRTL, applyDocumentDirection } from './lib/i18n.js'
import { exportScheduleCSV, exportScheduleXLSX, generateChecksSheetXLSX, generateClientOfferPdf, generateDocumentFile } from './lib/docExports.js'
import { buildDocumentBody } from './lib/buildDocumentBody.js'
import { buildCalculationPayload } from './lib/payloadBuilders.js'
import { validateCalculatorInputs } from './lib/validateCalculatorInputs.js'

import { useCalculatorSummaries } from './hooks/useCalculatorSummaries.js'
import { useComparison } from './hooks/useComparison.js'
import { loadSavedCalculatorState, usePersistCalculatorState } from './hooks/useCalculatorPersistence.js'
import EvaluationPanel from './components/calculator/EvaluationPanel.jsx'
import PaymentSchedule from './components/calculator/PaymentSchedule.jsx'
import ClientInfoForm from './components/calculator/ClientInfoFormMin.jsx'
import UnitInfoSection from './components/calculator/UnitInfoSection.jsx'
import ContractDetailsForm from './components/calculator/ContractDetailsForm.jsx'
import InputsForm from './components/calculator/InputsForm.jsx'
import LoadingButton from './components/LoadingButton.jsx'
import DiscountHint from './components/DiscountHint.jsx'
import CustomNotesSection from './components/calculator/CustomNotesSection.jsx'
import { fetchLatestStandardPlan, generatePlan } from './services/calculatorApi.js'
import { fetchHealth, fetchMessage } from './services/systemApi.js'
import { useDynamicPayments } from './hooks/useDynamicPayments.js'
import { useUnitSearch } from './hooks/useUnitSearch.js'
import { useCalculatorEmbedding } from './hooks/useCalculatorEmbedding.js'
import { useAcceptanceThresholds } from './hooks/useAcceptanceThresholds.js'
import BlockUnitButton from './components/calculator/BlockUnitButton.jsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const LS_KEY = 'uptown_calc_form_state_v2'

import styles from './styles/calculatorStyles.js'

// moved DiscountHint to components/DiscountHint.jsx

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
  // Units catalog (typeahead) via hook
  const {
    unitsCatalog,
    unitQuery,
    unitSearchLoading,
    unitDropdownOpen,
    setUnitQuery,
    setUnitDropdownOpen
  } = useUnitSearch()

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

  // Centrally-managed acceptance thresholds (TM-approved, loaded from API) via hook
  const thresholdsCfg = useAcceptanceThresholds()

  // Load persisted state
  useEffect(() => {
    const saved = loadSavedCalculatorState(LS_KEY)
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
  }, [])

  // Load global Standard Plan on mount to populate rate/duration/frequency for consultants
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const sp = await fetchLatestStandardPlan(API_URL)
        if (!mounted || !sp) return
        setStdPlan(s => ({
          ...s,
          financialDiscountRate: Number(sp.std_financial_rate_percent) || s.financialDiscountRate
        }))
        setInputs(s => ({
          ...s,
          planDurationYears: s.planDurationYears || Number(sp.plan_duration_years) || 5,
          installmentFrequency: s.installment_frequency || 'monthly'
        }))
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

  // moved TypeAndUnitPicker to components/TypeAndUnitPicker.jsx

  // Persist on change (moved to hook)
  const snapshot = useMemo(() => ({
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
    customNotes,
    feeSchedule,
    unitPricingBreakdown
  }), [mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes, feeSchedule, unitPricingBreakdown])
  usePersistCalculatorState(LS_KEY, snapshot)

  // Expose imperative APIs for embedding contexts (moved to hook)
  useCalculatorEmbedding({
    mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes,
    genResult, preview, setClientInfo, setUnitInfo, setStdPlan, setUnitPricingBreakdown, setFeeSchedule, setCurrency
  })

  // Initial health check
  useEffect(() => {
    async function load() {
      try {
        const [healthRes, msgRes] = await Promise.all([
          fetchHealth(API_URL),
          fetchMessage(API_URL)
        ])
        setHealth(healthRes)
        setMessage(msgRes.message)
      } catch (err) {
        setMessage('Failed to reach API. Is Docker running?')
      }
    }
    load()
  }, [])

  // moved payload builder to lib/payloadBuilders.js
  function buildPayload() {
    return buildCalculationPayload({ mode, stdPlan, unitInfo, inputs, firstYearPayments, subsequentYears })
  }

  // Client-side inline validation (mirrors server-side constraints)
  function validateForm() {
    const e = {}
    // Ensure offerDate is present; default to today if missing
    const todayStr = new Date().toISOString().slice(0, 10)
    if (!inputs.offerDate) {
      setInputs(s => ({ ...s, offerDate: todayStr }))
    } else {
      const d = new Date(inputs.offerDate)
      const iso = isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''
      if (!iso) e.offerDate = 'Invalid date'
    }
    // Ensure firstPaymentDate is present; default to offerDate or today
    const baseDefault = inputs.offerDate || todayStr
    if (!inputs.firstPaymentDate) {
      setInputs(s => ({ ...s, firstPaymentDate: baseDefault }))
    } else {
      const d = new Date(inputs.firstPaymentDate)
      const iso = isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''
      if (!iso) e.firstPaymentDate = 'Invalid date'
    }

    const payload = buildCalculationPayload({ mode, stdPlan, unitInfo, inputs, firstYearPayments, subsequentYears })
    const vErrors = validateCalculatorInputs(payload, inputs, firstYearPayments, subsequentYears)
    const allErrors = { ...e, ...vErrors }
    setErrors(allErrors)
    return { valid: Object.keys(allErrors).length === 0, payload }
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
      const data = await generatePlan(body, API_URL)
      setGenResult(data)
    } catch (e) {
      setGenError(e.message || String(e))
    } finally {
      setGenLoading(false)
    }
  }

  // (removed legacy inline document generation block; replaced by generateDocumentFile helper usage)

  async function exportClientOfferPdf() {
    try {
      setDocError('')
      setDocProgress(0)
      setDocLoading(true)

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

      const { blob, filename } = await generateClientOfferPdf(body, API_URL, (p) => setDocProgress(typeof p === 'function' ? p(docProgress) : p))
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

  // (removed inline exportScheduleXLSX and generateChecksSheetXLSX; using helpers from lib/docExports.js)

  // Computed summaries (from preview)
  const summaries = useCalculatorSummaries(preview)

  // Comparison: Approved Standard PV vs Current Offer PV
  const comparison = useComparison({ stdPlan, preview, inputs, firstYearPayments, subsequentYears, genResult, thresholdsCfg })

  // --- Handlers for dynamic arrays (moved to hook) ---
  const {
    addFirstYearPayment,
    updateFirstYearPayment,
    removeFirstYearPayment,
    addSubsequentYear,
    updateSubsequentYear,
    removeSubsequentYear
  } = useDynamicPayments(setFirstYearPayments, setSubsequentYears)
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
            <EvaluationPanel
              evaluation={genResult.evaluation}
              role={role}
              dealId={props?.dealId}
              API_URL={API_URL}
              showInlineOverride={!props?.dealId && (role === 'property_consultant' || role === 'sales_manager')}
              onInlineOverride={async () => {
                try {
                  // Require unit and REJECT state
                  const uid = Number(unitInfo?.unit_id) || 0
                  if (!(uid > 0)) { alert('Select a unit from Inventory first.'); return }
                  if (genResult?.evaluation?.decision !== 'REJECT') { alert('Override is only applicable when the plan is REJECT.'); return }
                  // Require minimal client info (same rules as block button)
                  const ci = clientInfo || {}
                  const required = ['buyer_name','nationality','id_or_passport','id_issue_date','birth_date','address','phone_primary','email']
                  const missing = required.filter(k => !(ci[k] && String(ci[k]).trim() !== ''))
                  if (missing.length) { alert('Please fill all client information fields before requesting override.'); return }
                  // Build deal payload from snapshot
                  const titleParts = []
                  if (ci.buyer_name) titleParts.push(ci.buyer_name)
                  if (unitInfo.unit_code || unitInfo.unit_number) titleParts.push(unitInfo.unit_code || unitInfo.unit_number)
                  const title = titleParts.join(' - ') || 'New Deal'
                  const amount = Number(genResult?.totals?.totalNominalIncludingMaintenance ?? genResult?.totals?.totalNominal ?? stdPlan?.totalPrice ?? 0)
                  const unitType = unitInfo?.unit_type || null
                  const details = { calculator: { mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes, feeSchedule, genResult } }
                  // Create deal
                  const createResp = await fetchWithAuth(`${API_URL}/api/deals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, amount, unitType, details })
                  })
                  const createData = await createResp.json()
                  if (!createResp.ok) { alert(createData?.error?.message || 'Failed to create deal'); return }
                  const dealId = createData?.deal?.id
                  // Request override with optional reason
                  const reason = window.prompt('Provide a reason for override request (optional):', '') || null
                  const orResp = await fetchWithAuth(`${API_URL}/api/deals/${dealId}/request-override`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                  })
                  const orData = await orResp.json()
                  if (!orResp.ok) { alert(orData?.error?.message || 'Failed to request override'); return }
                  alert('Override requested. You can track it on the Deal Detail page.')
                } catch (e) {
                  alert(e?.message || 'Failed to request override')
                }
              }}
            />
            <small style={styles.metaText}>
              {/* Keep this note in English for now as it is managerial guidance */}
              Thresholds are set by the Financial Manager and approved by Top Management. The evaluation above is computed server-side.
            </small>
          </section>
        )}

        

        {/* Data Entry UI — New Sections */}
        <ClientInfoForm
          role={role}
          clientInfo={clientInfo}
          setClientInfo={setClientInfo}
          styles={styles}
          language={language}
          unitBlocked={Boolean(unitInfo?.blocked_until) || (Number(unitInfo?.unit_id) > 0 && (unitInfo?.available === false))}
        />

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

        <CustomNotesSection
          styles={styles}
          language={language}
          role={role}
          customNotes={customNotes}
          setCustomNotes={setCustomNotes}
        />

        {/* Inline actions aligned with Client Info flow */}
        <BlockUnitButton
          role={role}
          unitInfo={unitInfo}
          clientInfo={clientInfo}
          genResult={genResult}
          language={language}
          styles={styles}
          API_URL={API_URL}
        />

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
                  onClick={async () => {
                    try {
                      setDocError('')
                      setDocLoading(true)
                      const { valid, payload } = validateForm()
                      if (!valid) { setDocError('Please fix validation errors before generating the document.'); setDocLoading(false); return }
                      const docPart = buildDocumentBody('reservation_form', { language, currency, clientInfo, unitInfo, stdPlan, genResult, inputs })
                      const body = {
                        documentType: 'reservation_form',
                        language,
                        currency,
                        ...payload,
                        ...docPart
                      }
                      const { blob, filename } = await generateDocumentFile('reservation_form', body, API_URL)
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url; a.download = filename
                      document.body.appendChild(a); a.click(); document.body.removeChild(a)
                      URL.revokeObjectURL(url)
                    } catch (e) {
                      setDocError(e.message || String(e))
                    } finally {
                      setDocLoading(false)
                    }
                  }}
                  style={styles.btnPrimary}
                >
                  {t('generate_reservation_form', language)}
                </button>
              )}
              {/* Contract — Contract Person only */}
              {authUser?.role === 'contract_person' && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDocError('')
                      setDocLoading(true)
                      const { valid, payload } = validateForm()
                      if (!valid) { setDocError('Please fix validation errors before generating the document.'); setDocLoading(false); return }
                      const docPart = buildDocumentBody('contract', { language, currency, clientInfo, unitInfo, stdPlan, genResult, inputs })
                      const body = {
                        documentType: 'contract',
                        language,
                        currency,
                        ...payload,
                        ...docPart
                      }
                      const { blob, filename } = await generateDocumentFile('contract', body, API_URL)
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url; a.download = filename
                      document.body.appendChild(a); a.click(); document.body.removeChild(a)
                      URL.revokeObjectURL(url)
                    } catch (e) {
                      setDocError(e.message || String(e))
                    } finally {
                      setDocLoading(false)
                    }
                  }}
                  style={styles.btnPrimary}
                >
                  {t('generate_contract', language)}
                </button>
              )}
              {/* Exports (CSV/XLSX/Checks) — Financial Admin only */}
              {authUser?.role === 'financial_admin' && (
                <>
                  <button type="button" onClick={() => exportScheduleXLSX(genResult, language)} disabled={!schedule.length} style={styles.btn}>
                    {t('export_xlsx', language)}
                  </button>
                  <button type="button" onClick={() => generateChecksSheetXLSX(genResult, clientInfo, unitInfo, currency, language)} disabled={!schedule.length} style={styles.btn}>
                    {t('generate_checks_sheet', language)}
                  </button>
                  <button type="button" onClick={() => exportScheduleCSV(genResult, language)} disabled={!schedule.length} style={styles.btn}>
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