// Global domain type declarations for editor tooling and incremental typing.
// This file does not affect the runtime build and can coexist with plain JS.

export interface Unit {
  id: number
  code: string
  description?: string
  unit_type?: string
  unit_type_id?: number
  unit_type_name?: string
  model_id?: number
  model_name?: string
  model_code?: string
  area?: number
  orientation?: string
  has_garden?: boolean
  garden_area?: number
  has_roof?: boolean
  roof_area?: number
  garage_area?: number
  base_price?: number
  garden_price?: number
  roof_price?: number
  storage_price?: number
  garage_price?: number
  maintenance_price?: number
  total_price?: number
  currency?: string
  available?: boolean
  unit_status?: string
}

export type Frequency = 'monthly' | 'quarterly' | 'bi-annually' | 'annually'

export interface FirstYearPayment {
  amount: number
  month: number
  type: 'dp' | 'regular'
}

export interface SubsequentYear {
  totalNominal: number
  frequency: Frequency
}

export interface CalculatorInputs {
  salesDiscountPercent: number
  dpType: 'amount' | 'percentage'
  downPaymentValue: number
  planDurationYears: number
  installmentFrequency: Frequency
  additionalHandoverPayment: number
  handoverYear: number
  splitFirstYearPayments: boolean
  firstYearPayments: FirstYearPayment[]
  subsequentYears: SubsequentYear[]
  baseDate?: string | null
  maintenancePaymentAmount?: number
  maintenancePaymentMonth?: number
  garagePaymentAmount?: number
  garagePaymentMonth?: number
}

export type CalculationMode =
  | 'evaluateCustomPrice'
  | 'calculateForTargetPV'
  | 'customYearlyThenEqual_useStdPrice'
  | 'customYearlyThenEqual_targetPV'

export interface PlanRequest {
  mode: CalculationMode
  unitId: number
  inputs: CalculatorInputs
  language: 'en' | 'ar'
  currency: string
}

export interface ScheduleEntry {
  label: string
  month: number
  amount: number
  date: string | null
  writtenAmount?: string
}

export interface PlanResponse {
  ok: boolean
  schedule: ScheduleEntry[]
  totals: { count: number; totalNominal: number }
  meta: Record<string, unknown>
}