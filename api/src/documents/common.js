import puppeteer from 'puppeteer'

/**
 * Puppeteer singleton (per-process).
 */
let browserPromise = null

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
  }
  return browserPromise
}

/**
 * Standard API error helper.
 */
export function bad(res, code, message, details) {
  return res.status(code).json({
    error: { message, details },
    timestamp: new Date().toISOString()
  })
}

/**
 * Cairo-local timestamp string "DD-MM-YYYY HH:mm:ss".
 */
export function cairoTimestamp() {
  const timeZone = process.env.TIMEZONE || process.env.TZ || 'Africa/Cairo'
  const d = new Date()
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]))
  const dd = parts.day || '01'
  const mm = parts.month || '01'
  const yyyy = parts.year || '1970'
  const hh = parts.hour || '00'
  const mi = parts.minute || '00'
  const ss = parts.second || '00'
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
}

/**
 * Helper: format date (ISO-ish) to DD-MM-YYYY, falling back to simple swap.
 */
export function fmtDateDDMMYYYY(s) {
  if (!s) return ''
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}-${mm}-${yyyy}`
  }
  const parts = String(s).split('-')
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : s
}