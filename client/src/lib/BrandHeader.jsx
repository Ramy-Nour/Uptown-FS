import React, { useEffect, useMemo, useState } from 'react'

const BRAND = {
  primary: '#A97E34', // corporate color
  primaryDark: '#8B672C'
}

export default function BrandHeader({ title, onLogout }) {
  const appTitle = title || (import.meta.env.VITE_APP_TITLE || 'Uptown Financial System')
  const envLogo = import.meta.env.VITE_COMPANY_LOGO_URL || ''
  const [logoUrl, setLogoUrl] = useState('/logo.svg')
  const [user, setUser] = useState(null)
  const [queueCount, setQueueCount] = useState(0)

  // API health banner state
  const [apiHealthy, setApiHealthy] = useState(null) // null = unknown, true/false
  const [apiHealthMsg, setApiHealthMsg] = useState('')

  useEffect(() => {
    let mounted = true
    const candidates = [
      '/logo/logo.svg',
      '/logo/logo.png',
      '/logo/logo.jpg',
      '/branding/logo.svg',
      '/branding/logo.png',
      '/branding/logo.jpg',
      envLogo || '',
      '/logo.svg'
    ].filter(Boolean)

    const tryNext = (idx) => {
      if (!mounted || idx >= candidates.length) return
      const url = candidates[idx]
      const img = new Image()
      img.onload = () => {
        if (mounted) setLogoUrl(url)
      }
      img.onerror = () => tryNext(idx + 1)
      img.src = url
    }
    tryNext(0)
    try {
      const raw = localStorage.getItem('auth_user')
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    return () => { mounted = false }
  }, [envLogo])

  // Poll queue counts for approver roles
  useEffect(() => {
    let t
    async function poll() {
      try {
        const token = localStorage.getItem('auth_token')
        const role = JSON.parse(localStorage.getItem('auth_user') || '{}')?.role
        let url = ''
        if (role === 'sales_manager') url = '/api/workflow/payment-plans/queue/sm'
        else if (role === 'financial_manager') url = '/api/workflow/payment-plans/queue/fm'
        else if (['ceo', 'vice_chairman', 'chairman', 'top_management'].includes(role)) url = '/api/workflow/payment-plans/queue/tm'
        if (!url) { setQueueCount(0); return }
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
        const resp = await fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` }})
        const data = await resp.json().catch(() => ({}))
        if (resp.ok) {
          setQueueCount((data?.payment_plans || []).length)
        } else {
          setQueueCount(0)
        }
      } catch {
        setQueueCount(0)
      } finally {
        t = setTimeout(poll, 30000) // every 30s
      }
    }
    poll()
    return () => t && clearTimeout(t)
  }, [])

  // API health check banner
  useEffect(() => {
    let t
    const ctrl = new AbortController()
    const check = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
        const resp = await fetch(`${API_URL}/api/health`, { cache: 'no-store', signal: ctrl.signal })
        if (!resp.ok) {
          setApiHealthy(h => (h === false ? h : false))
          setApiHealthMsg(m => (m === `API responded with ${resp.status}` ? m : `API responded with ${resp.status}`))
        } else {
          setApiHealthy(h => (h === true ? h : true))
          setApiHealthMsg(m => (m === '' ? m : ''))
        }
      } catch (e) {
        if (ctrl.signal.aborted) return
        setApiHealthy(h => (h === false ? h : false))
        setApiHealthMsg(m => (m === 'Failed to reach API' ? m : 'Failed to reach API'))
      } finally {
        t = setTimeout(check, 30000)
      }
    }
    check()
    return () => {
      ctrl.abort()
      t && clearTimeout(t)
    }
  }, [])

  const navForRole = (role) => {
    // Base without calculator
    const base = [{ label: 'Deals', href: '/deals' }]
    // Base with calculator shortcut
    const baseWithCalc = [{ label: 'Calculator', href: '/deals/create' }, ...base]
    const baseWithoutCalc = base
    const queuesLink = { label: `Queues${queueCount ? ` (${queueCount})` : ''}`, href: '/deals/queues' }
    switch (role) {
      case 'superadmin':
        return [
          { label: 'Users', href: '/admin/users' },
          { label: 'Sales Team', href: '/admin/sales' },
          { label: 'Contracts Team', href: '/admin/contracts-team' },
          { label: 'Finance Team', href: '/admin/finance-team' },
          { label: 'Commission Policies', href: '/admin/commission-policies' },
          { label: 'Payment Thresholds', href: '/admin/payment-thresholds' }
        ]
      case 'admin':
        return [
          { label: 'Users', href: '/admin/users' },
          { label: 'Sales Team', href: '/admin/sales' },
          { label: 'Contracts Team', href: '/admin/contracts-team' },
          { label: 'Finance Team', href: '/admin/finance-team' },
          { label: 'Payment Thresholds', href: '/admin/payment-thresholds' }
        ]
      case 'financial_manager':
        return [
          ...baseWithCalc,
          queuesLink,
          { label: 'Current Blocks', href: '/deals/current-blocks' },
          { label: 'Reservations', href: '/deals/reservations-queue' },
          { label: 'Inventory Drafts', href: '/admin/inventory-drafts' },
          { label: 'Inventory Changes', href: '/admin/inventory-changes' },
          { label: 'Rejected Requests', href: '/admin/rejected-pricings' },
          { label: 'Finance Team', href: '/admin/finance-team' },
          { label: 'Standard Pricing', href: '/admin/standard-pricing' },
          { label: 'Unit Models', href: '/admin/unit-models' },
          { label: 'Holds', href: '/admin/holds' },
          { label: 'Payment Thresholds', href: '/admin/payment-thresholds' },
       ]
      case 'financial_admin':
        return [
          ...baseWithCalc,
          { label: 'Current Blocks', href: '/deals/current-blocks' },
          { label: 'Inventory', href: '/admin/inventory' },
          { label: 'My Inventory Requests', href: '/admin/inventory-change-history' },
          { label: 'Standard Pricing', href: '/admin/standard-pricing' },
          { label: 'My Proposals', href: '/deals/my-proposals' }
        ]
      case 'sales_manager':
        return [
          ...baseWithCalc,
          queuesLink,
          { label: 'Sales Team', href: '/admin/sales-team' },
          { label: 'Team Proposals', href: '/deals/team-proposals' },
          { label: 'Holds', href: '/admin/holds' },
          { label: 'Workflow Logs', href: '/admin/workflow-logs' }
        ]
      case 'property_consultant':
        return [
          ...baseWithCalc,
          { label: 'My Proposals', href: '/deals/my-proposals' }
        ]
      case 'contract_person':
        return [
          ...baseWithoutCalc
        ]
      case 'contract_manager':
        return [
          ...baseWithoutCalc,
          { label: 'Contracts Team', href: '/admin/contracts-team' },
          { label: 'Workflow Logs', href: '/admin/workflow-logs' },
          { label: 'Hold Approvals', href: '/admin/hold-approvals' }
        ]
      // --- THIS SECTION IS MODIFIED ---
      case 'ceo':
      case 'chairman':
      case 'vice_chairman':
      case 'top_management':
        return [
          ...baseWithoutCalc,
          { label: 'Unit Model Queue', href: '/deals/queues' },
          { label: 'Pricing Queue', href: '/admin/standard-pricing-approvals' },
          { label: 'Payment Threshold Approvals', href: '/admin/payment-thresholds' },
          { label: 'Workflow Logs', href: '/admin/workflow-logs' },
          { label: 'Hold Approvals', href: '/admin/hold-approvals' }
        ]
      // --- END OF MODIFICATION ---
      default:
        return base
    }
  }

  const shortcuts = navForRole(user?.role)
  const pathname = useMemo(() => (typeof window !== 'undefined' ? window.location.pathname : ''), [])

  const baseBtnStyle = {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.7)',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    transition: 'all .15s ease-in-out'
  }

  const hoverBtnStyle = {
    background: '#fff',
    color: BRAND.primary,
    border: '1px solid #fff'
  }

  const activeBtnStyle = {
    background: BRAND.primaryDark,
    color: '#fff',
    border: `1px solid ${BRAND.primaryDark}`,
    boxShadow: '0 0 0 2px rgba(255,255,255,0.15) inset'
  }

  const activeHoverStyle = {
    background: '#775723',
    color: '#fff',
    border: '1px solid #775723'
  }

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 1000 }}>
      <div dir="ltr" style={{ background: BRAND.primary, color: '#fff', borderBottom: `4px solid ${BRAND.primaryDark}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl ? (
              <img src={logoUrl} alt="Company Logo" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            ) : (
              <div style={{ height: 36, width: 36, borderRadius: 6, background: '#fff', color: BRAND.primary, display: 'grid', placeItems: 'center', fontWeight: 800 }}>U</div>
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{appTitle}</div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                Welcome {user?.email || ''} {user?.role ? `(${user.role})` : ''} • Shortcuts:
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {shortcuts.map((s, idx) => {
              const isActive = pathname && (pathname === s.href || pathname.startsWith(s.href + '/'))
              return (
                <HoverButton
                  key={idx}
                  onClick={() => { window.location.href = s.href }}
                  style={{ ...baseBtnStyle, ...(isActive ? activeBtnStyle : null) }}
                  hoverStyle={isActive ? activeHoverStyle : hoverBtnStyle}
                >
                  {s.label}
                </HoverButton>
              )
            })}
            {onLogout && (
              <HoverButton
                onClick={onLogout}
                style={baseBtnStyle}
                hoverStyle={hoverBtnStyle}
              >
                Logout
              </HoverButton>
            )}
          </div>
        </div>
      </div>
      {apiHealthy === false && (
        <div dir="ltr" style={{ background: '#991b1b', color: '#fff', padding: '6px 12px', borderBottom: '1px solid #7f1d1d' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              API unreachable. {apiHealthMsg ? `(${apiHealthMsg}) ` : ''}Please ensure containers are running.
            </span>
            <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/health`} target="_blank" rel="noreferrer" style={{ color: '#fff', textDecoration: 'underline' }}>
              Check /api/health
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function HoverButton({ children, style, hoverStyle, onClick, type = 'button' }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...(style || {}), ...(hover ? (hoverStyle || {}) : {}) }}
    >
      {children}
    </button>
  )
}