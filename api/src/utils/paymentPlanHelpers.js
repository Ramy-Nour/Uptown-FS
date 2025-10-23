export function resolveMaintenanceMonth(maintenancePaymentMonth, handoverYear) {
  // Treat empty string, null, undefined, NaN, or <= 0 as "not provided"
  const raw = maintenancePaymentMonth
  const num = (raw === '' || raw == null) ? NaN : Number(raw)
  if (!Number.isFinite(num) || num <= 0) {
    const hy = Number(handoverYear) || 0
    return hy > 0 ? hy * 12 : 12
  }
  return num
}