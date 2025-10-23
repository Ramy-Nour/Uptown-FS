import { resolveMaintenanceMonth } from '../utils/paymentPlanHelpers.js'

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

function testResolveMaintenanceMonth() {
  // '' with handoverYear=2 -> 24
  assert(resolveMaintenanceMonth('', 2) === 24, "'' should fallback to 24 (2 years)")

  // 0 with handoverYear=2 -> 24
  assert(resolveMaintenanceMonth(0, 2) === 24, '0 should fallback to 24 (2 years)')

  // undefined with handoverYear not set -> 12
  assert(resolveMaintenanceMonth(undefined, null) === 12, 'undefined should fallback to 12 when no handoverYear')

  // explicit month > 0 is used as-is
  assert(resolveMaintenanceMonth(3, 5) === 3, 'explicit positive month should be used as-is')

  console.log('✓ resolveMaintenanceMonth tests passed.')
}

try {
  testResolveMaintenanceMonth()
} catch (e) {
  console.error(e)
  process.exit(1)
}