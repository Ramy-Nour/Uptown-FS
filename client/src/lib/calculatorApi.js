/**
 * Calculator API helper — builds modern payloads and calls the backend.
 * Uses JSDoc typedefs to keep types clear without introducing TypeScript.
 */

/**
 * @typedef {Object} Unit
 * @property {number} id
 * @property {string} code
 * @property {string} [description]
 * @property {string} [unit_type]
 * @property {number} [model_id]
 * @property {number} [area]
 * @property {string} [orientation]
 * @property {boolean} [has_garden]
 * @property {number} [garden_area]
 * @property {boolean} [has_roof]
 * @property {number} [roof_area]
 * @property {number} [garage_area]
 * @property {number} [base_price]
 * @property {string} [currency]
 */

/**
 * @typedef {Object} CalculatorInputs
 * @property {number} salesDiscountPercent
 * @property {"amount"|"percentage"} dpType
 * @property {number} downPaymentValue
 * @property {number} planDurationYears
 * @property {"monthly"|"quarterly"|"bi-annually"|"annually"} installmentFrequency
 * @property {number} additionalHandoverPayment
 * @property {number} handoverYear
 * @property {boolean} splitFirstYearPayments
 * @property {Array<{amount:number,month:number,type:"dp"|"regular"}>} firstYearPayments
 * @property {Array<{totalNominal:number,frequency:"monthly"|"quarterly"|"bi-annually"|"annually"}>} subsequentYears
 * @property {string|null} [baseDate]
 * @property {number} [maintenancePaymentAmount]
 * @property {number} [maintenancePaymentMonth]
 * @property {number} [garagePaymentAmount]
 * @property {number} [garagePaymentMonth]
 */

/**
 * @typedef {Object} PlanRequest
 * @property {"evaluateCustomPrice"|"calculateForTargetPV"|"customYearlyThenEqual_useStdPrice"|"customYearlyThenEqual_targetPV"} mode
 * @property {number} unitId
 * @property {CalculatorInputs} inputs
 * @property {"en"|"ar"} language
 * @property {string} currency
 */

/**
 * @typedef {Object} PlanResponse
 * @property {boolean} ok
 * @property {Array<{label:string, month:number, amount:number, date:string|null, writtenAmount?:string}>} schedule
 * @property {{ count:number, totalNominal:number }} totals
 * @property {Object} meta
 */

import { API_URL, fetchWithAuth } from './apiClient.js'

/**
 * Build a modern plan request payload from the calculator snapshot and selected unit.
 * @param {any} snapshot
 * @param {number} unitId
 * @returns {PlanRequest}
 */
export function buildPlanRequest(snapshot, unitId) {
  const inputs = snapshot?.inputs || {}
  const mode = snapshot?.mode || 'calculateForTargetPV'
  const body = {
    mode,
    unitId: Number(unitId),
    inputs: {
      salesDiscountPercent: Number(inputs.salesDiscountPercent) || 0,
      dpType: inputs.dpType || 'amount',
      downPaymentValue: Number(inputs.downPaymentValue) || 0,
      planDurationYears: Number(inputs.planDurationYears) || 5,
      installmentFrequency: inputs.installmentFrequency || 'monthly',
      additionalHandoverPayment: Number(inputs.additionalHandoverPayment) || 0,
      handoverYear: Number(inputs.handoverYear) || 0,
      splitFirstYearPayments: !!inputs.splitFirstYearPayments,
      firstYearPayments: Array.isArray(snapshot?.firstYearPayments) ? snapshot.firstYearPayments : [],
      subsequentYears: Array.isArray(snapshot?.subsequentYears) ? snapshot.subsequentYears : [],
      baseDate: snapshot?.contractInfo?.contract_date || snapshot?.contractInfo?.reservation_form_date || null,
      maintenancePaymentAmount: Number(snapshot?.feeSchedule?.maintenancePaymentAmount) || 0,
      maintenancePaymentMonth: Number(snapshot?.feeSchedule?.maintenancePaymentMonth) || 0,
      garagePaymentAmount: Number(snapshot?.feeSchedule?.garagePaymentAmount) || 0,
      garagePaymentMonth: Number(snapshot?.feeSchedule?.garagePaymentMonth) || 0
    },
    language: snapshot?.language || 'en',
    currency: snapshot?.currency || 'EGP'
  }
  return body
}

/**
 * Call the backend modern endpoint to generate the plan.
 * @param {PlanRequest} body
 * @returns {Promise<PlanResponse>}
 */
export async function generatePlan(body) {
  const resp = await fetchWithAuth(`${API_URL}/api/generate-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await resp.json()
  if (!resp.ok) {
    const msg = data?.error?.message || 'Plan generation failed'
    throw new Error(msg)
  }
  return /** @type {PlanResponse} */ (data)
}