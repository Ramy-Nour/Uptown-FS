import { useEffect } from 'react'
import { buildCalculationPayload } from '../lib/payloadBuilders.js'

export function useCalculatorEmbedding({
  mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes,
  genResult, preview, setClientInfo, setUnitInfo, setStdPlan, setUnitPricingBreakdown, setFeeSchedule, setCurrency
}) {
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
      const payload = buildCalculationPayload({ mode, stdPlan, unitInfo, inputs, firstYearPayments, subsequentYears })
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
      setClientInfo(s => ({ ...s, ...partial }))
    }
    const applyUnitInfo = (partial) => {
      if (!partial || typeof partial !== 'object') return
      setUnitInfo(s => ({ ...s, ...partial }))
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
      if (window.__uptown_calc_getSnapshot === getSnapshot) delete window.__uptown_calc_getSnapshot
      if (window.__uptown_calc_applyClientInfo === applyClientInfo) delete window.__uptown_calc_applyClientInfo
      if (window.__uptown_calc_applyUnitInfo === applyUnitInfo) delete window.__uptown_calc_applyUnitInfo
      if (window.__uptown_calc_applyUnitPrefill === applyUnitPrefill) delete window.__uptown_calc_applyUnitPrefill
    }
  }, [
    mode, language, currency, stdPlan, inputs, firstYearPayments, subsequentYears, clientInfo, unitInfo, contractInfo, customNotes, genResult, preview,
    setClientInfo, setUnitInfo, setStdPlan, setUnitPricingBreakdown, setFeeSchedule, setCurrency
  ])
}