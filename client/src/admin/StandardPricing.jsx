import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchWithAuth } from '../lib/apiClient.js';
import { notifyError, notifySuccess } from '../lib/notifications.js';
import LoadingButton from '../components/LoadingButton.jsx';
import SkeletonRow from '../components/SkeletonRow.jsx';
import { th, td, ctrl, btnPrimary, btnSuccess, btnDanger, tableWrap, table, pageContainer, pageTitle, errorText, metaText, btn } from '../lib/ui.js';
import BrandHeader from '../lib/BrandHeader.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';



export default function StandardPricing() {
  const [models, setModels] = useState([]);
  const [pricings, setPricings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stdPlanCfg, setStdPlanCfg] = useState(null);

  const user = JSON.parse(localStorage.getItem('auth_user') || '{}');
  const role = user?.role;

  // Form state
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [selectedModelCode, setSelectedModelCode] = useState('');
  const [stdPrice, setStdPrice] = useState('');
  const [dpPercent, setDpPercent] = useState(20);
  const [years, setYears] = useState(5);
  const [frequency, setFrequency] = useState('monthly');
  const [annualRate, setAnnualRate] = useState(12);
  const [maintenancePrice, setMaintenancePrice] = useState('');
  const [garagePrice, setGaragePrice] = useState('');
  const [gardenPrice, setGardenPrice] = useState('');
  const [roofPrice, setRoofPrice] = useState('');
  const [storagePrice, setStoragePrice] = useState('');

  const selectedModel = useMemo(() => {
    const id = Number(selectedModelId);
    return models.find(m => m.id === id) || null;
  }, [selectedModelId, models]);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const reqs = [
          fetchWithAuth(`${API_URL}/api/pricing/unit-model`),
          // Allow both FM and Top-Management to view models (endpoint updated to allow read)
          fetchWithAuth(`${API_URL}/api/inventory/unit-models`),
          // Active global standard plan (for rate/duration/frequency used in PV)
          fetchWithAuth(`${API_URL}/api/standard-plan/latest`)
        ];
        const [pricingRes, modelsRes, stdPlanRes] = await Promise.all(reqs);
        const pricingData = await pricingRes.json();
        if (!pricingRes.ok) throw new Error(pricingData?.error?.message || 'Failed to fetch pricing');

        setPricings(pricingData.pricings || []);

        const modelsData = await modelsRes.json();
        if (!modelsRes.ok) throw new Error(modelsData?.error?.message || 'Failed to fetch models');
        const items = modelsData.items || modelsData.models || [];
        setModels(items);

        const stdPlanData = await stdPlanRes.json();
        if (stdPlanRes.ok) {
          setStdPlanCfg(stdPlanData.standardPlan || null);
        }
      } catch (e) {
        setError(e.message || 'An error occurred');
        notifyError(e, 'Failed to load standard pricing');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [role]);

  // Keep selects in sync
  useEffect(() => {
    if (!selectedModelId) return;
    const m = models.find(x => x.id === Number(selectedModelId));
    if (!m) return;
    setSelectedModelName(m.model_name || '');
    setSelectedModelCode(m.model_code || '');
  }, [selectedModelId, models]);

  useEffect(() => {
    if (!selectedModelName) return;
    const m = models.find(x => (x.model_name || '').toLowerCase() === selectedModelName.toLowerCase());
    if (m) {
      setSelectedModelId(String(m.id));
      setSelectedModelCode(m.model_code || '');
    }
  }, [selectedModelName, models]);

  useEffect(() => {
    if (!selectedModelCode) return;
    const m = models.find(x => (x.model_code || '').toLowerCase() === selectedModelCode.toLowerCase());
    if (m) {
      setSelectedModelId(String(m.id));
      setSelectedModelName(m.model_name || '');
    }
  }, [selectedModelCode, models]);

  // When selected model has no garden/roof, clear corresponding prices and keep inputs disabled
  useEffect(() => {
    const hasGarden = !!selectedModel?.has_garden;
    const hasRoof = !!selectedModel?.has_roof;
    if (!hasGarden && gardenPrice) setGardenPrice('');
    if (!hasRoof && roofPrice) setRoofPrice('');
  }, [selectedModel, gardenPrice, roofPrice]);

  const handleUpsertPricing = async (e) => {
    e.preventDefault();
    try {
      if (!selectedModelId) throw new Error('Select a Unit Model first');
      if (!stdPrice) throw new Error('Enter standard price');

      // Enforce garden/roof constraints: if the model has no garden/roof, price must be N.A/empty (treated as 0)
      const hasGarden = !!selectedModel?.has_garden;
      const hasRoof = !!selectedModel?.has_roof;
      if (!hasGarden && Number(gardenPrice || 0) > 0) {
        throw new Error('This unit model has no garden. Garden price must be N.A or empty.');
      }
      if (!hasRoof && Number(roofPrice || 0) > 0) {
        throw new Error('This unit model has no roof. Roof price must be N.A or empty.');
      }

      const res = await fetchWithAuth(`${API_URL}/api/pricing/unit-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: Number(selectedModelId),
          price: Number(stdPrice),
          maintenance_price: maintenancePrice === '' ? 0 : Number(maintenancePrice),
          garage_price: garagePrice === '' ? 0 : Number(garagePrice),
          garden_price: gardenPrice === '' ? 0 : Number(gardenPrice),
          roof_price: roofPrice === '' ? 0 : Number(roofPrice),
          storage_price: storagePrice === '' ? 0 : Number(storagePrice),
          std_financial_rate_percent: Number(annualRate),
          plan_duration_years: Number(years),
          installment_frequency: String(frequency),
          calculated_pv: Number(pv)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed to save pricing');
      notifySuccess('Pricing request saved');
      // Refresh list
      const listRes = await fetchWithAuth(`${API_URL}/api/pricing/unit-model`);
      const listData = await listRes.json();
      if (listRes.ok) setPricings(listData.pricings || []);
    } catch (e) {
      const msg = e.message || String(e);
      setError(msg);
      notifyError(e, 'Failed to save pricing');
    }
  };

  const [rowLoading, setRowLoading] = useState({});
  // Map of pricingId -> authoritative PV from backend
  const [rowPv, setRowPv] = useState({});
  const handleApproveStatus = async (id, status, reason) => {
    try {
      setRowLoading(s => ({ ...s, [id]: true }));
      const res = await fetchWithAuth(`${API_URL}/api/pricing/unit-model/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason: reason || null })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed to update status');
      setPricings(p => p.map(x => x.id === id ? data.pricing : x));
      notifySuccess(`Pricing ${status}`);
    } catch (e) {
      const msg = e.message || String(e);
      setError(msg);
      notifyError(e, 'Failed to update status');
    } finally {
      setRowLoading(s => ({ ...s, [id]: false }));
    }
  };

  // Fetch authoritative PV for each pricing row using backend engine
  useEffect(() => {
    let abort = false;

    const normalizeFreq = (f) => {
      const v = String(f || '').toLowerCase().trim();
      if (v === 'biannually') return 'bi-annually';
      return v || 'monthly';
    };

    async function computeAllPVs() {
      try {
        const entries = await Promise.all((pricings || []).map(async (p) => {
          try {
            const totalNominal =
              (Number(p.price || 0)) +
              (Number(p.garden_price || 0)) +
              (Number(p.roof_price || 0)) +
              (Number(p.storage_price || 0)) +
              (Number(p.garage_price || 0));

            // Derive row-specific years/frequency/rate with same precedence as the table
            const rowYears =
              (p.plan_duration_years != null ? Number(p.plan_duration_years) : null)
              ?? (stdPlanCfg?.plan_duration_years != null ? Number(stdPlanCfg.plan_duration_years) : null)
              ?? 5;

            const rowFreq =
              (p.installment_frequency ? normalizeFreq(p.installment_frequency) : null)
              ?? (stdPlanCfg?.installment_frequency ? normalizeFreq(stdPlanCfg.installment_frequency) : null)
              ?? 'monthly';

            const rowRate =
              (p.std_financial_rate_percent != null ? Number(p.std_financial_rate_percent) : null)
              ?? (stdPlanCfg?.std_financial_rate_percent != null ? Number(stdPlanCfg.std_financial_rate_percent) : null)
              ?? 0;

            if (!(totalNominal > 0) || !(Number.isInteger(rowYears) && rowYears > 0)) {
              return [p.id, 0];
            }

            // Always include the Down Payment in PV (use the current form's DP% as policy)
            const dpPct = Number(dpPercent) || 0;

            const body = {
              mode: 'evaluateCustomPrice',
              stdPlan: {
                totalPrice: totalNominal,
                financialDiscountRate: Number(rowRate) || 0,
                calculatedPV: 0
              },
              inputs: {
                salesDiscountPercent: 0,
                dpType: 'percentage',
                downPaymentValue: dpPct, // include DP in PV calculation
                planDurationYears: rowYears,
                installmentFrequency: rowFreq,
                additionalHandoverPayment: 0,
                handoverYear: 1,
                splitFirstYearPayments: false,
                firstYearPayments: [],
                subsequentYears: []
              }
            };

            const resp = await fetchWithAuth(`${API_URL}/api/calculate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data) {
              return [p.id, 0];
            }
            const calcPv = Number(data?.data?.calculatedPV) || 0;
            return [p.id, calcPv];
          } catch {
            return [p.id, 0];
          }
        }));

        if (abort) return;
        const next = {};
        for (const [id, val] of entries) next[id] = val;
        setRowPv(next);
      } catch {
        if (!abort) setRowPv({});
      }
    }

    computeAllPVs();
    return () => { abort = true; };
  }, [pricings, stdPlanCfg, dpPercent]);

  // Pricing history modal state
  const [historyPricingId, setHistoryPricingId] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rejectReasons, setRejectReasons] = useState({});

  const [pv, setPv] = useState(0);
  const [pvError, setPvError] = useState('');
  const pvDebounce = useRef(null);

  useEffect(() => {
    if (pvDebounce.current) clearTimeout(pvDebounce.current);

    pvDebounce.current = setTimeout(async () => {
      try {
        const total =
          (Number(stdPrice || 0)) +
          (selectedModel?.has_garden ? Number(gardenPrice || 0) : 0) +
          (selectedModel?.has_roof ? Number(roofPrice || 0) : 0) +
          (Number(storagePrice || 0)) +
          (Number(garagePrice || 0));

        const yrs = Number(years) || 0;
        const rate = Number(annualRate);
        const freq = String(frequency || 'monthly');

        // Basic guards
        if (!(total > 0) || !(yrs > 0) || !['monthly','quarterly','bi-annually','annually'].includes(freq)) {
          setPv(0);
          setPvError('');
          return;
        }

        // Build request mirroring LivePreview pattern, using authoritative backend engine
        const body = {
          mode: 'evaluateCustomPrice',
          stdPlan: {
            totalPrice: total,
            financialDiscountRate: rate,
            calculatedPV: 0
          },
          inputs: {
            salesDiscountPercent: 0,
            dpType: 'percentage',
            downPaymentValue: Number(dpPercent) || 0,
            planDurationYears: yrs,
            installmentFrequency: freq,
            additionalHandoverPayment: 0,
            handoverYear: 1,
            splitFirstYearPayments: false,
            firstYearPayments: [],
            subsequentYears: []
          }
        };

        const resp = await fetchWithAuth(`${API_URL}/api/calculate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json().catch(() => null);

        if (!resp.ok || !data) {
          setPv(0);
          setPvError(data?.error?.message || 'Failed to calculate PV');
          return;
        }

        const calcPv = Number(data?.data?.calculatedPV) || 0;
        setPv(calcPv);
        setPvError('');
      } catch (e) {
        setPv(0);
        setPvError('Failed to calculate PV');
      }
    }, 400);

    return () => {
      if (pvDebounce.current) clearTimeout(pvDebounce.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdPrice, gardenPrice, roofPrice, storagePrice, garagePrice, dpPercent, years, frequency, annualRate, selectedModel]);

  const installmentsCount = useMemo(() => {
    const y = Number(years) || 0;
    switch (frequency) {
      case 'monthly': return y * 12;
      case 'quarterly': return y * 4;
      case 'bi-annually': return y * 2;
      case 'annually': return y * 1;
      default: return 0;
    }
  }, [years, frequency]);

  const pricePerSqM = useMemo(() => {
    const total = Number(stdPrice) || 0;
    const area = Number(selectedModel?.area) || 0;
    if (!total || !area) return 0;
    return total / area;
  }, [stdPrice, selectedModel]);

  async function openPricingHistory(id) {
    setHistoryPricingId(id);
    setHistoryLoading(true);
    setHistoryItems([]);
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/pricing/unit-model/${id}/audit`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load history');
      setHistoryItems(data.audit || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setHistoryLoading(false);
    }
  }
  function closePricingHistory() {
    setHistoryPricingId(null);
    setHistoryItems([]);
    setHistoryLoading(false);
  }

  const handleLogout = async () => {
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
  }

  if (loading) {
    return (
      <div>
        <BrandHeader onLogout={handleLogout} />
        <div style={pageContainer}>
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Model</th>
                  <th style={th}>Code</th>
                  <th style={th}>Area</th>
                  <th style={th}>Price</th>
                  <th style={th}>Garden</th>
                  <th style={th}>Roof</th>
                  <th style={th}>Storage</th>
                  <th style={th}>Garage</th>
                  <th style={th}>Maintenance</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                  <th style={th}>Approved</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <SkeletonRow key={i} widths={['lg','sm','sm','lg','sm','sm','sm','sm','sm','sm','lg','lg','sm']} tdStyle={td} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={pageTitle}>List Price Configuration (by Unit Model)</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {role === 'financial_manager' ? (
              <>
                <a href="/admin/unit-models" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
                  Manage Unit Models
                </a>
                <a href="/admin/unit-model-changes" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
                  Model Changes
                </a>
              </>
            ) : null}
            {(role === 'ceo' || role === 'chairman' || role === 'vice_chairman') ? (
              <a href="/admin/unit-model-changes" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
                Review Model Changes
              </a>
            ) : null}
          </div>
        </div>

        {error ? <p style={errorText}>{error}</p> : null}

        {role === 'financial_manager' && (
              <form onSubmit={handleUpsertPricing} style={{ border: '1px solid #e6eaf0', borderRadius: 12, padding: 16, marginTop: 12, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ marginTop: 0 }}>Select Unit Model</h3>
                  <a href="/admin/standard-pricing-rejected" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>Rejected Requests</a>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div style={metaText}>Model Name</div>
                    <select value={selectedModelName} onChange={e => setSelectedModelName(e.target.value)} style={ctrl}>
                      <option value="">Select name…</option>
                      {models.map(m => (
                        <option key={m.id} value={m.model_name || ''}>
                          {m.model_name || ''} {m.area ? `— ${m.area} m²` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={metaText}>Model Code</div>
                    <select value={selectedModelCode} onChange={e => setSelectedModelCode(e.target.value)} style={ctrl}>
                      <option value="">Select code…</option>
                      {models.map(m => (
                        <option key={m.id} value={m.model_code || ''}>
                          {m.model_code || '(none)'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

            {selectedModel ? (
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <div>
                  <div style={metaText}>Orientation</div>
                  <input value={String(selectedModel.orientation || '').replace(/_/g,' ')} readOnly style={ctrl} />
                </div>
                <div>
                  <div style={metaText}>Area (m²)</div>
                  <input value={selectedModel.area ?? ''} readOnly style={ctrl} />
                </div>
                <div>
                  <div style={metaText}>Garden</div>
                  <input value={selectedModel.has_garden ? (selectedModel.garden_area ? `Yes (${selectedModel.garden_area} m²)` : 'Yes') : 'No'} readOnly style={ctrl} />
                </div>
                <div>
                  <div style={metaText}>Roof</div>
                  <input value={selectedModel.has_roof ? (selectedModel.roof_area ? `Yes (${selectedModel.roof_area} m²)` : 'Yes') : 'No'} readOnly style={ctrl} />
                </div>
              </div>
            ) : null}

            <h3 style={{ marginTop: 16 }}>Standard Price & Terms</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              <div>
                <div style={metaText}>Base Unit Price (EGP)</div>
                <input type="number" value={stdPrice} onChange={e => setStdPrice(e.target.value)} style={ctrl} placeholder="e.g. 3,500,000" />
              </div>
              <div>
                <div style={metaText}>Garden Price (EGP)</div>
                <input
                  type="number"
                  value={gardenPrice}
                  onChange={e => setGardenPrice(e.target.value)}
                  style={ctrl}
                  placeholder={selectedModel?.has_garden ? "e.g. 120,000" : "N.A (no garden)"}
                  disabled={!selectedModel?.has_garden}
                />
                {!selectedModel?.has_garden ? <div style={metaText}>This model has no garden. Price must be N.A.</div> : null}
              </div>
              <div>
                <div style={metaText}>Roof Price (EGP)</div>
                <input
                  type="number"
                  value={roofPrice}
                  onChange={e => setRoofPrice(e.target.value)}
                  style={ctrl}
                  placeholder={selectedModel?.has_roof ? "e.g. 180,000" : "N.A (no roof)"}
                  disabled={!selectedModel?.has_roof}
                />
                {!selectedModel?.has_roof ? <div style={metaText}>This model has no roof. Price must be N.A.</div> : null}
              </div>
              <div>
                <div style={metaText}>Storage Price (EGP)</div>
                <input type="number" value={storagePrice} onChange={e => setStoragePrice(e.target.value)} style={ctrl} placeholder="e.g. 75,000" />
              </div>
              <div>
                <div style={metaText}>Garage Price (EGP)</div>
                <input type="number" value={garagePrice} onChange={e => setGaragePrice(e.target.value)} style={ctrl} placeholder="e.g. 200,000" />
              </div>
              <div>
                <div style={metaText}>Maintenance Price (EGP) — excluded from PV</div>
                <input type="number" value={maintenancePrice} onChange={e => setMaintenancePrice(e.target.value)} style={ctrl} placeholder="e.g. 150,000" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
              <div>
                <div style={metaText}>Down Payment (%)</div>
                <input type="number" value={dpPercent} onChange={e => setDpPercent(e.target.value)} style={ctrl} />
              </div>
              <div>
                <div style={metaText}>Plan Duration (years)</div>
                <input type="number" value={years} onChange={e => setYears(e.target.value)} style={ctrl} />
              </div>
              <div>
                <div style={metaText}>Annual Financial Rate (%)</div>
                <input type="number" value={annualRate} onChange={e => setAnnualRate(e.target.value)} style={ctrl} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
              <div>
                <div style={metaText}>Installment Frequency</div>
                <select value={frequency} onChange={e => setFrequency(e.target.value)} style={ctrl}>
                  <option value="monthly">monthly</option>
                  <option value="quarterly">quarterly</option>
                  <option value="bi-annually">bi-annually</option>
                  <option value="annually">annually</option>
                </select>
              </div>
              <div>
                <div style={metaText}>Total Price used for PV (auto)</div>
                <input
                  readOnly
                  style={ctrl}
                  value={
                    Number(stdPrice || 0)
                    + (selectedModel?.has_garden ? Number(gardenPrice || 0) : 0)
                    + (selectedModel?.has_roof ? Number(roofPrice || 0) : 0)
                    + Number(storagePrice || 0)
                    + Number(garagePrice || 0)
                  }
                />
              </div>
            </div>

            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div>
                <div style={metaText}>Calculated PV</div>
                <div style={{ fontWeight: 600 }}>{Number(pv || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP</div>
              </div>
              <div>
                <div style={metaText}>Calculated Installments</div>
                <div style={{ fontWeight: 600 }}>{installmentsCount || 0}</div>
              </div>
              <div>
                <div style={metaText}>Price per m²</div>
                <div style={{ fontWeight: 600 }}>
                  {Number(pricePerSqM || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP/m²
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button type="submit" style={btnPrimary} disabled={!selectedModelId || !stdPrice}>Save/Request Approval</button>
              <span style={{ ...metaText, marginLeft: 8 }}>Top-Management approval required.</span>
            </div>
          </form>
        )}

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Model</th>
                <th style={th}>Code</th>
                <th style={th}>Area</th>
                <th style={th}>Price (EGP)</th>
                <th style={th}>Garden</th>
                <th style={th}>Roof</th>
                <th style={th}>Storage</th>
                <th style={th}>Garage</th>
                <th style={th}>Maintenance</th>
                <th style={th}>Calculated PV</th>
                <th style={th}>Annual Financial Rate (%)</th>
                <th style={th}>Plan Duration (years)</th>
                <th style={th}>Installment Frequency</th>
                <th style={th}>Status</th>
                <th style={th}>Created By</th>
                <th style={th}>Approved By</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pricings.map(p => {
                const totalNominal = Number(p.price || 0)
                  + (Number(p.garden_price || 0))
                  + (Number(p.roof_price || 0))
                  + (Number(p.storage_price || 0))
                  + (Number(p.garage_price || 0));

                // Prefer per-pricing financial settings when available; fall back to active Standard Plan; then local form defaults
                const rowYears = (p.plan_duration_years != null ? Number(p.plan_duration_years) : null)
                  ?? (stdPlanCfg?.plan_duration_years != null ? Number(stdPlanCfg.plan_duration_years) : null)
                  ?? (Number(years) || 5);
                const normalizeFreq = (f) => {
                  const v = String(f || '').toLowerCase().trim();
                  if (v === 'biannually') return 'bi-annually';
                  return v || 'monthly';
                };
                const rowFreq = (p.installment_frequency ? normalizeFreq(p.installment_frequency) : null)
                  ?? (stdPlanCfg?.installment_frequency ? normalizeFreq(stdPlanCfg.installment_frequency) : null)
                  ?? normalizeFreq(frequency || 'monthly');
                const rowRate = (p.std_financial_rate_percent != null ? Number(p.std_financial_rate_percent) : null)
                  ?? (stdPlanCfg?.std_financial_rate_percent != null ? Number(stdPlanCfg.std_financial_rate_percent) : null)
                  ?? (Number(annualRate) || 0);

                const rowPvValue = rowPv[p.id];
                return (
                 <tr key={p.id}>
                    <td style={td}>{p.model_name}</td>
                    <td style={td}>{p.model_code || ''}</td>
                    <td style={td}>{Number(p.area || 0).toLocaleString()}</td>
                    <td style={td}>{Number(p.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}>{
                      (() => {
                        const hasGarden = p.has_garden ?? (p.garden_area != null ? Number(p.garden_area) > 0 : null);
                        const val = Number(p.garden_price || 0);
                        if (hasGarden === false) return 'N.A';
                        return val ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (hasGarden === false ? 'N.A' : '0.00');
                      })()
                    }</td>
                    <td style={td}>{
                      (() => {
                        const hasRoof = p.has_roof ?? (p.roof_area != null ? Number(p.roof_area) > 0 : null);
                        const val = Number(p.roof_price || 0);
                        if (hasRoof === false) return 'N.A';
                        return val ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (hasRoof === false ? 'N.A' : '0.00');
                      })()
                    }</td>
                    <td style={td}>{Number(p.storage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}>{Number(p.garage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}>{Number(p.maintenance_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}>{Number(rowPvValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={td}>{Number(rowRate || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td style={td}>{rowYears}</td>
                    <td style={td}>{rowFreq}</td>
                    <td style={td}>{p.status}</td>
                    <td style={td}>{p.created_by_email || ''}</td>
                    <td style={td}>{p.approved_by_email || ''}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <LoadingButton onClick={() => openPricingHistory(p.id)}>History</LoadingButton>
                        {(role === 'ceo' || role === 'chairman' || role === 'vice_chairman') && p.status === 'pending_approval' ? (
                          <>
                            <LoadingButton onClick={() => handleApproveStatus(p.id, 'approved')} loading={rowLoading[p.id]} style={btnSuccess}>Approve</LoadingButton>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                placeholder="Reason (for rejection)"
                                value={rejectReasons[p.id] || ''}
                                onChange={e => setRejectReasons(s => ({ ...s, [p.id]: e.target.value }))}
                                style={ctrl}
                              />
                              <LoadingButton onClick={() => handleApproveStatus(p.id, 'rejected', rejectReasons[p.id])} loading={rowLoading[p.id]} style={btnDanger}>Reject</LoadingButton>
                            </div>
                          </>
                        ) : null}
                        {(role === 'financial_manager') && p.status === 'pending_approval' && p.created_by === (JSON.parse(localStorage.getItem('auth_user') || '{}').id) ? (
                          <LoadingButton
                            onClick={async () => {
                              if (!window.confirm('Cancel this pending pricing request?')) return
                              try {
                                const res = await fetchWithAuth(`${API_URL}/api/pricing/unit-model/${p.id}`, { method: 'DELETE' })
                                const data = await res.json()
                                if (!res.ok) throw new Error(data?.error?.message || 'Cancel failed')
                                notifySuccess('Request cancelled')
                                // refresh list
                                const listRes = await fetchWithAuth(`${API_URL}/api/pricing/unit-model`)
                                const listData = await listRes.json()
                                if (listRes.ok) setPricings(listData.pricings || [])
                              } catch (e) {
                                const msg = e.message || String(e)
                                setError(msg)
                                notifyError(e, 'Cancel failed')
                              }
                            }}
                            style={btn}
                          >
                            Cancel Request
                          </LoadingButton>
                        ) : null}
                        {!( (role === 'ceo' || role === 'chairman' || role === 'vice_chairman') && p.status === 'pending_approval') && !((role === 'financial_manager') && p.status === 'pending_approval' && p.created_by === (JSON.parse(localStorage.getItem('auth_user') || '{}').id)) ? (
                          <span style={metaText}>—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pricings.length === 0 && (
                <tr>
                  <td style={td} colSpan={15}><span style={metaText}>No unit model pricing entries.</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(role === 'ceo' || role === 'chairman' || role === 'vice_chairman') && (
          <div style={{ marginTop: 16, border: '1px solid #e6eaf0', borderRadius: 12, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Unit Models (Read-only)</h3>
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>ID</th>
                    <th style={th}>Name</th>
                    <th style={th}>Code</th>
                    <th style={th}>Area</th>
                    <th style={th}>Orientation</th>
                    <th style={th}>Garden</th>
                    <th style={th}>Roof</th>
                    <th style={th}>Created</th>
                    <th style={th}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map(m => (
                    <tr key={m.id}>
                      <td style={td}>{m.id}</td>
                      <td style={td}>{m.model_name}</td>
                      <td style={td}>{m.model_code || ''}</td>
                      <td style={td}>{m.area}</td>
                      <td style={td}>{String(m.orientation || '').replace(/_/g,' ')}</td>
                      <td style={td}>{m.has_garden ? (m.garden_area ? `Yes (${m.garden_area} m²)` : 'Yes') : 'No'}</td>
                      <td style={td}>{m.has_roof ? (m.roof_area ? `Yes (${m.roof_area} m²)` : 'Yes') : 'No'}</td>
                      <td style={td}>{m.created_at ? new Date(m.created_at).toLocaleString() : ''}</td>
                      <td style={td}>{m.updated_at ? new Date(m.updated_at).toLocaleString() : ''}</td>
                    </tr>
                  ))}
                  {models.length === 0 && (
                    <tr>
                      <td style={td} colSpan={9}><span style={metaText}>No models.</span></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pricing history modal */}
        {historyPricingId != null && (
          <div className="fixed inset-0" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: 800 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Pricing History — #{historyPricingId}</h3>
                <button onClick={closePricingHistory} style={btn}>Close</button>
              </div>
              <div style={{ padding: 12, maxHeight: '65vh', overflowY: 'auto' }}>
                {historyLoading ? (
                  <div style={metaText}>Loading…</div>
                ) : historyItems.length === 0 ? (
                  <div style={metaText}>No history found.</div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {historyItems.map(h => (
                      <li key={h.id} style={{ borderBottom: '1px solid #f2f5fa', padding: '8px 0' }}>
                        <div><strong>{h.action}</strong> — {h.created_at ? new Date(h.created_at).toLocaleString() : ''}</div>
                        <div style={metaText}>By: {h.changed_by_email || h.changed_by || ''}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                          {h.details ? (typeof h.details === 'string' ? h.details : JSON.stringify(h.details, null, 2)) : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
                <button onClick={closePricingHistory} style={btn}>Close</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
