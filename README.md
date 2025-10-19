# Uptown-FS — Full Stack Financial System

This repository contains a Dockerized full‑stack app for Uptown’s financial workflows:

- Client: React + Vite (client/)
- API: Node.js + Express (api/)
- Database: PostgreSQL 16 (containerized)
- Orchestration: Docker Compose (docker-compose.yml)
- Dev environment: GitHub Codespaces with auto‑forwarded ports (.devcontainer/)

The README is the living source of truth. Every significant change must be reflected here. See “AI/Agent Contribution Rules” below.

---

## Quick Start (local machine)

Prerequisites: Docker Desktop.

1) Create your environment file
- Copy .env.example to .env and adjust if needed
  - ADMIN_EMAIL / ADMIN_PASSWORD (for initial seed)
  - DB_PASSWORD (already set to apppass for dev)

2) Start the stack
- docker compose up -d --build

3) Access locally
- Client: http://localhost:5173
- API Health: http://localhost:3000/api/health
- API Message: http://localhost:3000/api/message

Stop everything:
- docker compose down
Note: Do NOT use docker compose down -v unless you want to wipe the database volume.

---

## Quick Start (GitHub Codespaces)

This repo is configured for Codespaces.

- Auto‑forwarded ports: 3001 (API), 5173 (Client)
- Auto‑start stack: docker compose up -d runs on container start (postStartCommand)

First run in a Codespace:
1) Rebuild the container so devcontainer settings take effect
- F1 → “Codespaces: Rebuild Container”
2) The stack will start automatically (postStartCommand).
3) Open the Ports panel and click:
- 5173 → Client
- 3001 → API

Notes:
- We expose the API container’s port 3000 to the host port 3001 to avoid conflicts (compose uses 3001:3000).
- The client is configured for Codespaces HMR and uses the forwarded hosts, not localhost.
- If you open a public port URL, GitHub may show a one‑time safety warning; click “Continue.”

Health checks:
- curl -sS https://<codespace>-3001.app.github.dev/api/health
- Client should hot‑reload without ws://localhost references.

---

## Ports and Environment

- API container listens on 0.0.0.0:3000.
- Host forwards to:
  - 3001 → API (container:3000)
  - 5173 → Client (container:5173)
- Vite config (client/vite.config.js) detects Codespaces and:
  - Sets HMR over wss to the forwarded 5173 host
  - Sets origin to the public 5173 host
  - Sets VITE_API_URL to the public 3001 host
- docker-compose.yml passes CODESPACE_NAME and GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN to client so the config can compute public URLs.

---

## Current Features and Status

1) Calculation Service and API
- Endpoint: POST /api/calculate
- Modes include:
  - evaluateCustomPrice
  - calculateForTargetPV
  - customYearlyThenEqual_useStdPrice
  - customYearlyThenEqual_targetPV
- Returns totals, PV, and metadata to drive the UI.

2) Generator and Documents
- Endpoint: POST /api/generate-plan
- Document generation endpoint scaffolded: POST /api/generate-document
- Client can export schedule to CSV/XLSX and generate a checks sheet XLSX.

3) Inventory/Units (stubs for integration)
- Basic endpoints scaffolded; UI has type and unit pickers with server calls.

4) OCR Module (scaffold)
- OCR upload endpoint design (tesseract primary; Google Cloud Vision optional via GCV_API_KEY) documented for future enablement.

5) Auth and Roles (client side)
- Role-aware UI sections (e.g., thresholds, contract sections).
- Client persists session/role in localStorage.

6) Codespaces Integration
- Devcontainer auto‑forwards 3001/5173 and auto‑starts the stack.
- Vite HMR configured to work behind Codespaces.

## Configuration Requirements

For calculations to work correctly, the following must be configured:

- Per-Pricing Financial Settings are required for unit/model flows:
  - std_financial_rate_percent: numeric percent (annual), must be > 0
  - plan_duration_years: integer ≥ 1
  - installment_frequency: one of { monthly, quarterly, biannually, annually } (normalized to 'bi-annually' internally)
  - The calculator and plan generation will not fall back to Active Standard Plan when a unit/model is selected; per-pricing terms must exist and be approved.

If no active Standard Plan exists or its values are invalid, the server will attempt to use the Financial Manager’s stored “Calculated PV” for the selected unit/model. If that is not present, the API returns 422 with a clear message.

---

7) Recent Fixes and Changes
Timestamp convention: prefix new bullets with [YYYY-MM-DD HH:MM] (UTC) to track when changes were applied.
- [2025-10-19 03:35] Block Requests queue (Sales Manager/Consultant): 
  - API: Added GET /api/blocks/pending (role-aware) and PATCH /api/blocks/:id/cancel (Consultant can cancel own; Sales Manager can cancel any pending). 
  - UI: Added /deals/block-requests page listing pending block requests with Cancel action where allowed, and a “Block Requests” link in Deals Dashboard for Sales Manager/Consultant/FM.
  - Purpose: Let Sales Managers monitor and manage pending unit block requests before FM approval.
- [2025-10-19 03:10] Unit Block request endpoint fixed: Corrected API route prefix so client POST /api/blocks/request matches Express router. Previously, routes were registered under /api/blocks/blocks/* causing HTML/DOCTYPE errors when the client tried to parse JSON. Updated paths in api/src/blockManagement.js to remove the extra '/blocks' prefix (request, approve, current, extend). Also expanded requester roles to include Sales Manager so both Property Consultant and Sales Manager can initiate block requests; approvals remain by Financial Manager.
- [2025-10-19 02:35] Buyers[] propagated to generate-plan: The /api/generate-plan request now includes a buyers array (1–4) built from ClientInfo, alongside existing payload fields. This enables the API (or downstream consumers) to consider multiple buyers if needed without breaking existing single-buyer logic. File: client/src/App.jsx.
- [2025-10-19 02:20] Document generation buyers[] mapping: buildDocumentBody now includes a structured buyers array (1–4) built from ClientInfo fields, enabling templates to iterate over all buyers. The existing single-buyer placeholders remain unchanged for Buyer 1. File: client/src/App.jsx.
- [2025-10-19 02:00] Client Info — multi-buyer support added: The minimal Client Info form now lets you select 1–4 buyers (clientInfo.number_of_buyers). For Buyers 2–4, identical fields open using suffixed keys (buyer_name_2, nationality_2, id_or_passport_2, id_issue_date_2, birth_date_2, address_2, phone_primary_2, phone_secondary_2, email_2). No OCR and no buffering; pure controlled inputs to keep typing stable. File: client/src/components/calculator/ClientInfoFormMin.jsx.
- [2025-10-19 01:40] Multi-buyer support (UI only): ClientInfoFormMin.jsx now includes a "Number of Buyers" selector (1–4). For buyers 2–4, the form opens additional sections with suffixed field keys (e.g., buyer_name_2, nationality_2, …). This keeps existing single-buyer keys intact while allowing up to four buyers without OCR or buffering.
- [2025-10-19 01:25] Path alignment fix: App.jsx now imports client/src/components/calculator/ClientInfoFormMin.jsx (matching existing filesystem naming). Added ClientInfoFormMin.jsx as the minimal no-OCR template. This resolves Vite import-analysis failure due to filename mismatch.
- [2025-10-19 01:10] Added a Minimal Client Information form (client/src/components/calculator/ClientInfoFormMinimal.jsx) patterned after InputsForm’s simple controlled inputs. App.jsx now imports the Minimal form to isolate typing/focus issues with the least complexity. The Basic form remains for reference; the OCR-enabled form persists under archive/ for future steps.
- [2025-10-19 00:45] Removed legacy client/src/components/calculator/ClientInfoForm.jsx to avoid confusion. App.jsx now imports ClientInfoFormBasic.jsx. The OCR-enabled version is preserved at client/src/components/calculator/archive/ClientInfoForm_OCR.jsx for future reintroduction.
- [2025-10-19 00:30] Introduced a basic Client Information form without OCR to isolate input focus/typing issues. The calculator now uses client/src/components/calculator/ClientInfoFormBasic.jsx, which retains buffered inputs and focus-aware sync but removes OCR mode and scanner entirely. The previous OCR-enabled form was archived at client/src/components/calculator/archive/ClientInfoForm_OCR.jsx for future reintroduction once stability is confirmed. App.jsx import updated to point to the Basic form.
- [2025-10-18 03:35] Client Information input stability — guarded parent sync: Added lastSyncedRef and a shallow equality check to skip parent→local syncing when values haven’t changed, and adjusted the selective merge to return the previous state when no changes are applied. This prevents unnecessary re-renders during typing that could reset the cursor or appear to “lose” focus. OCR apply also updates lastSyncedRef. File: client/src/components/calculator/ClientInfoForm.jsx.
- [2025-10-18 03:14] Lazy-loaded OCR module: ClientInfoForm now dynamically imports the OCR scanner with React.lazy + Suspense, reducing initial bundle size. File: client/src/components/calculator/ClientInfoForm.jsx.
- [2025-10-18 03:12] Modular OCR: Moved ClientIdScanner to client/src/components/ocr/ClientIdScanner.jsx and refactored to use local callbacks (onStart/onApply/onError) instead of global window hooks. This improves modularity and avoids side-effects.
- [2025-10-18 03:10] Client Info entry modes (Manual vs OCR-assisted): Added a user toggle to select Manual entry or OCR-assisted. In OCR-assisted mode, only ID‑derived fields (buyer_name, nationality, id_or_passport, id_issue_date, birth_date, address) are populated; phones (phone_primary, phone_secondary) and email remain strictly manual. During OCR processing, auto‑filled fields are temporarily disabled to prevent focus/typing races; upon completion, a selective merge applies updates without touching manual‑only fields. Files: client/src/components/calculator/ClientInfoForm.jsx, client/src/components/ocr/ClientIdScanner.jsx.
- [2025-10-18 02:55] Client Information — stronger typing protection: Iteratively improved guards (typing flag, :focus-within detection, short focus transition window) and added selective parent→local merge to avoid overwriting the currently active field. File: client/src/components/calculator/ClientInfoForm.jsx.
- [2025-10-18 02:45] Client Information typing stability — enhanced guard + logging: Added a debounce-based guard in ClientInfoForm.jsx to suppress parent→local sync for 500ms after the last keystroke or while a field is focused. Also instrumented temporary console logging inside the sync useEffect to confirm when syncs are skipped vs applied, aiding field testing. This aims to prevent the “one-character-only” typing interruption caused by external state updates or rapid re-renders. File: client/src/components/calculator/ClientInfoForm.jsx.
- [2025-10-18 02:30] Target PV correction (Modes 2/4): The API now computes the Standard PV target as the true Present Value of the standard plan structure including its Down Payment, not the equal-installments-only baseline. In /api/calculate and /api/generate-plan, when resolving effectiveStdPlan for unit/model flows, we run the standard plan parameters through the engine (EvaluateCustomPrice) using the request’s Down Payment definition to derive calculatedPV. This fixes the issue where entering the standard Down Payment amount in Target-PV modes solved to a lower total price. With this change, using the standard plan’s DP, duration, and frequency in Mode 2 yields a solved New Price equal to the Standard Total Price. Files: api/src/app.js.
- [2025-10-18 00:00] Standard Pricing PV source fixed: Removed client-side duplicate PV formula in StandardPricing.jsx and now fetch the authoritative PV from the backend (/api/calculate) whenever form inputs change (price components, DP%, years, frequency, rate). Previously, the form used a local calculatePV that only considered Base Unit Price, causing mismatches (e.g., 4.3M total, 20% rate, 20% DP, 6y monthly showed ~2,730,836.86 instead of the backend’s ~2,937,031.55). Updated table rows as well to fetch and display authoritative PV per row using the same backend endpoint for consistency across the page.
- [2025-10-18 00:20] Client Information form stability and accessibility: Added id/name to all fields and associated labels with htmlFor; provided autocomplete hints (name, country-name, street-address, tel, email, bday). Implemented local buffered inputs that commit onBlur to parent state to prevent “one-character-only” typing interruptions caused by external re-renders. File: client/src/components/calculator/ClientInfoForm.jsx.
- [2025-10-18 01:10] Revert: In Target-PV modes (2 and 4), DP Type is enforced as amount (fixed) to avoid circular dependencies. UI disables percentage in these modes and backend treats any percentage input as an amount. This aligns with the established policy to prevent loops when solving for price from PV. Files: client/src/components/calculator/InputsForm.jsx (disable DP% in target-PV modes), api/services/calculationService.js (amount-only DP in target-PV solver).
- [2025-10-18 01:25] UX hint for Target-PV modes: Added an explanatory note next to Down Payment Type in Modes 2/4 clarifying why percentage is disabled and instructing users to enter a fixed amount. File: client/src/components/calculator/InputsForm.jsx.
- [2025-10-18 01:40] Client Information typing stability: Prevent parent state sync from clobbering in-progress typing by tracking the focused field and deferring external updates until blur. Added onFocus/onBlur per field and guarded the local buffer sync with focusedKey. File: client/src/components/calculator/ClientInfoForm.jsx.
- [2025-10-18 01:55] Client Information — address field fix: Corrected the textarea handlers to use onFocus={() => setFocusedKey('address')} and onBlur={() => { commit('address'); setFocusedKey(null) }} so the focus lock applies to the address field as well. File: client/src/components/calculator/ClientInfoForm.jsx.
- Resolved App.jsx merge conflicts; rateLocked computed once from unitInfo.
- Switched host API port to 3001 and updated client to talk to 3001.
- Added .devcontainer/devcontainer.json with forwardPorts and postStartCommand.
- Vite HMR configured for Codespaces (wss + origin).
- Docker Compose passes Codespaces env vars into client service.
- Inventory deals page now shows a clear empty-state message for sales roles. It explains that units only appear after: (1) Financial Admin creates drafts linked to a Unit Model with approved standard pricing, and (2) Financial Manager approves the drafts to mark them AVAILABLE. This helps when inventory appears in Admin pages but not under Deals → Inventory.
- Client Information enhanced: added Birth Date and moved the Egyptian ID scanner into the Client Information section (ClientIdScanner) so consultants can scan and auto-fill name, ID, address directly.
- Create Deal page: “Unit Type” relabeled to “Unit Model” and now displays model_code — model_name when available.
- Acceptance evaluation fix: PV rule now passes when Proposed PV ≤ Standard PV × tolerance (equality allowed). Previously it required ≥, which caused a false FAIL at 0 difference. Also added small epsilon to avoid float rounding issues.
- Third-year condition is already dynamic; it now reads min/max from payment_thresholds (with sensible fallbacks if not configured).
- UI cleanup: Removed duplicated “Unit & Project Information” section from Deals → Create Deal in favor of the upper “Selected Unit” summary, and added “Block / Sector” to that summary. Removed unused local state and draft autosave tied to the deleted section to prevent stale localStorage keys and simplify the component.
- Sales Consultant calculator UX: Hid “Std Financial Rate (%)” input for property consultants (it is pulled from approved standard and should not be editable). Also improved Down Payment UX—when DP Type = percentage, the input now shows a “%” suffix and enforces 0–100, reducing confusion about entering values.
- Removed obsolete “Standard PV vs Offer PV” comparison section from the calculator page; kept the server-side “Acceptance Evaluation” section only (as this is authoritative and up-to-date).
- Removed the “Payment Structure Metrics” section below Acceptance Evaluation to avoid duplicated/legacy presentation. The page now relies solely on the server-side Acceptance Evaluation.
- Acceptance Evaluation fix: PV rule now passes when Proposed PV ≤ Standard PV × tolerance (equality allowed). Previously it required ≥, which caused a false FAIL at 0 difference. Also added small epsilon to avoid float rounding issues.
- Mode explanations: The calculator now shows clear names and explanations for all four modes in the UI (English/Arabic). File: client/src/components/calculator/InputsForm.jsx.
- Down Payment control restored: Consultants can set the DP in all modes. Previous temporary behavior that ignored DP in PV-target modes has been removed. File: api/src/app.js.valuation banner: Compact banner now displays NPV-based decision with distinct colors (green for ACCEPT, stronger red for REJECT). When REJECT, it also lists unmet criteria (e.g., PV below standard, specific failed conditions) and shows a “Request Override” action that posts to /api/deals/:id/request-override.
- Offer/First Payment Dates: Added two required date pickers in Inputs — Offer Date and First Payment Date. Offer Date defaults to today; First Payment Date defaults to Offer Date. Plan generation uses First Payment Date as baseDate (fallback to Offer Date or today). Both dates are included in document generation (offer_date, first_payment_date) from Calculator and Deal Detail flows, and are now displayed above the Payment Schedule for clear visibility (also shown on Deal Detail and in the Dashboard list and exports).
- Create Deal UI: Removed the separate “Server Calculation” panel and its button; consultants generate the plan using the main “Calculate (Generate Plan)” action only.
- Dashboard: Added Offer Date and First Payment Date columns; included both in CSV/XLSX exports.
- Arabic/RTL support: Introduced a lightweight i18n system (client/src/lib/i18n.js) with t(), isRTL(), and applyDocumentDirection(). Updated calculator sections (InputsForm, ClientInfoForm, PaymentSchedule, and App.jsx headings/buttons) to render full Arabic labels and right-to-left layout when language = 'ar'. Also switched document <html dir> dynamically so the whole page reads RTL in Arabic.
- Payment Schedule Arabic improvements: The “الوصف” column now shows Arabic translations for schedule items like Down Payment, Equal Installment (قسط متساوي), Handover, Maintenance Fee, Garage Fee, and Year N (frequency). The description column is center-aligned for better readability in Arabic. File: client/src/components/calculator/PaymentSchedule.jsx.
- Header direction: The top navigation/header now forces LTR layout even when the page runs in Arabic (RTL) so consultant pages keep the header alignment unchanged. File: client/src/lib/BrandHeader.jsx.
- Client Information UX: Always show full client fields (name, nationality, ID/passport, issue date, birth date, address, primary phone, secondary phone, email). Stabilized input focus while typing by memoizing the form and removing role-based field switching that caused unmount/remount. OCR scanner remains available in the same section.
- Codespaces ports: Forwarded ports 3001 (API) and 5173 (client) now default to visibility: public and open in the browser automatically on forward. To apply, rebuild the container (F1 → “Codespaces: Rebuild Container”). File: .devcontainer/devcontainer.json.abic/RTL support: Introduced a lightweight i18n system (client/src/lib/i18n.js) with t(), isRTL(), and applyDocumentDirection(). Updated calculator sections (InputsForm, ClientInfoForm, PaymentSchedule, and App.jsx headings/buttons) to render full Arabic labels and right-to-left layout when language = 'ar'. Also switched document <html dir> dynamically so the whole page reads RTL in Arabic.

- Mode explanations panel: Added clear names and short descriptions for all four calculator modes in the UI (English/Arabic) to guide consultants when choosing a mode.
- Mode 4 clarified: “Custom Structure targeting Standard PV” now clearly states it lets you define split First Year and subsequent years, puts the remainder as equal installments (like Mode 3), but solves to match the Standard PV (like Mode 2). UI text only; engine was already correct.
- Down Payment rule for target-PV modes: In Modes 2 and 4 (Target PV), DP is treated as a fixed amount (not percentage) to avoid circular dependency as the final nominal price is solved from PV. UI enforces amount-only and backend coerces percentage to amount. Files: api/services/calculationService.js, client/src/components/calculator/InputsForm.jsx, client/src/App.jsx.
- Standard PV baseline fix: When resolving Standard Plan via unitId/standardPricingId, the API now computes Standard Calculated PV from the equal-installments baseline using the authoritative rate/duration/frequency instead of defaulting to the nominal total price. This ensures PV ≠ Standard Total Price and modes 2/4 target the correct PV. File: api/src/app.js.
- Consultant UI — New Price visibility: For target-PV modes (2 and 4), the calculator now displays the solved New Price (offer total) in the Inputs panel Live Preview area, so consultants can immediately see the price that matches Standard PV. File: client/src/components/calculator/InputsForm.jsx.
- Thresholds based on offer, not standard: Client-side preview percentages (for quick inline comparison before generating) now compute the Down Payment amount correctly when DP Type = percentage by basing it on the current offer total (preview/gen) instead of the Standard Total Price. File: client/src/App.jsx.
- [2025-10-16 00:00] Standard PV locking (Modes 2/4): When a unit is selected, the client now fetches the authoritative Standard PV from the server (/api/generate-plan evaluation.pv.standardPV) and locks it, preventing the UI from recomputing PV client-side. This fixes cases where Standard Price incorrectly equaled PV over multi‑year plans due to missing/zero rate context. Files: client/src/App.jsx.
- Standard Plan defaults hydration: On load, the client fetches the latest active Standard Plan and pre-fills financial rate, plan duration, and installment frequency for consultants, ensuring Std Calculated PV is derived consistently. File: client/src/App.jsx.
- Std Calculated PV read-only: The “Std Calculated PV” field in the calculator is now read-only and auto-derived from Standard Total Price, rate, duration and frequency. File: client/src/components/calculator/InputsForm.jsx.
- [2025-10-17 16:25] Client banner for missing per-pricing terms:
  - Calculator page shows a red policy banner when a unit/model is selected and the API returns 422 requiring per-pricing terms.
  - Message instructs to configure Annual Financial Rate, Duration, and Frequency on the Standard Pricing page for that unit model.
  File: client/src/App.jsx.
- Header stays LTR: Top navigation/header is always LTR even when Arabic is selected, keeping consultant layout stable.
- Payment Schedule Arabic polish: “الوصف” column shows Arabic labels for schedule rows and is center‑aligned in Arabic.
- Calculator PV baseline: Standard Calculated PV is now auto-computed on the client from Standard Total Price, financial rate, duration and frequency. This prevents it from mistakenly matching the nominal price and ensures Modes 2 and 4 solve a new final price against the correct Standard PV baseline. File: client/src/App.jsx.
- [2025-10-17 12:00] Frequency normalization and robust Standard PV resolution:
  - Added API-side frequency normalization (maps 'biannually' → 'bi-annually', case-insensitive, trims) and validated against engine enum.
  - Enforced authoritative baseline from active Standard Plan: std_financial_rate_percent, plan_duration_years, installment_frequency.
  - Removed silent fallback to 0% when Standard Plan is missing/invalid; server now either uses FM stored Calculated PV or returns 422 with a clear message.
  - Added diagnostics meta in responses: rateUsedPercent, durationYearsUsed, frequencyUsed, computedPVEqualsTotalNominal, usedStoredFMpv.
  - Fixed frequency mismatches by normalizing before switch statements and calculations. Files: api/src/app.js.

- [2025-10-17 15:10] Terminology correction: Standard Plan is configured by the Financial Manager and approved by Top Management. Updated README “Configuration Requirements” to reflect ownership and removed “global” wording.

Future tasks:
- PDF templates: map offer_date and first_payment_date placeholders in server-side document templates for Pricing Form, Reservation Form, and Contract.

Future Enhancements (proposed):
- Optional pending external update banner in ClientInfoForm: “New client data available — Apply now or after editing” with an explicit apply action.
- Versioned, deferred-apply strategy for external updates (e.g., OCR) across the app to avoid focus/typing races without timing heuristics.
- Further code-splitting: lazy-load larger calculator modules (UnitInfoSection, ContractDetailsForm) conditioned on role/mode to reduce initial bundle size.
- Tests: add React Testing Library unit/integration tests for form sync behavior (typing uninterrupted, OCR apply selective merge).
- Incremental TypeScript adoption for calculator payloads and API responses to improve safety and DX.
- Accessibility pass: ensure disabled states and status messages (OCR processing) are announced properly via ARIA.

---

## How to Work Day‑to‑Day

- Pull latest code in Codespaces:
  - Commit/stash your local changes
  - git pull --rebase
  - Rebuild container if devcontainer/ or Docker files changed:
    - F1 → Rebuild Container
  - Rebuild services if needed:
    - docker compose build
    - docker compose up -d
- Stop Codespace to save hours:
  - GitHub → Your profile → Codespaces → ••• → Stop
  - Or F1 → Codespaces: Stop Current Codespace

Persistence
- Postgres data is stored in the named volume db_data and survives restarts.
- Client form state persists in localStorage per Codespace URL.
- Avoid docker compose down -v unless you want to reset the database.

---

## Troubleshooting

- Client connects to localhost:5173 in browser logs:
  - Hard refresh the client page (Ctrl/Cmd+Shift+R)
  - Ensure you opened via the Ports panel 5173 public URL
  - Rebuild the client container: docker compose up -d --build client
- No ports appear in Ports panel:
  - Rebuild container; postStartCommand will run
  - Check docker compose ps; then docker logs -f app_client / app_api
- 500 on /src/*.jsx in dev overlay:
  - Check app_client logs for syntax errors and fix the file
- Merge conflicts:
  - Use VS Code Merge Editor; prefer “Accept Current” when keeping local branch
  - Remove all conflict markers <<<<<<<, =======, >>>>>>> before committing

---

## API Reference (selected)

POST /api/calculate
- Body schema:
  - mode: string (see modes)
  - stdPlan: { totalPrice, financialDiscountRate, calculatedPV }
  - inputs: {
      salesDiscountPercent,
      dpType, downPaymentValue,
      planDurationYears, installmentFrequency,
      additionalHandoverPayment, handoverYear,
      splitFirstYearPayments, firstYearPayments[], subsequentYears[]
    }

Health endpoints
- GET /api/health → { status: "OK" }
- GET /api/message → { message: "Hello..." }

---

## Branding and App Title

- Place a logo under client/public/logo/ (logo.svg/png/jpg). First found will be used.
- Legacy path supported: client/public/branding/
- Override via VITE_COMPANY_LOGO_URL
- Override app title via VITE_APP_TITLE

---

## Testing

API unit tests:
- cd api && npm run test

API integration tests:
- cd api && npm run test:integration

---

## Roadmap (next sessions)

- Next step: Reintroduce OCR into the Client Information flow incrementally (start from archived ClientInfoForm_OCR.jsx), keeping typing stability. Add explicit “Apply OCR” action with selective merge that never touches manual-only fields (phones, email).
- Wire real inventory endpoints and types/units data model.
- Implement authentication/authorization end‑to‑end (API issued tokens).
- Persist thresholds and management controls (admin UI + API).
- Finalize OCR pipeline and document generation templates.
- Add CI for lint/test on PRs and container build.
- Add “Export/Import” for local calculator state.

---

## Calculator Modularity Audit

Scope: review of calculator architecture, unused/broken files, and drift from modular design (no deletions performed).

Summary
- The calculator is intentionally modular (InputsForm, LivePreview, PaymentSchedule, UnitInfoSection, ClientInfoForm, ContractDetailsForm, EvaluationPanel).
- App.jsx has accumulated too many responsibilities (validation, payload building, comparison metrics, some deal-bridging). It still works, but should be split into hooks/utilities to restore clean modularity.

Findings — likely broken filename mismatches
- client/src/components/UnitDetailsDrawer.jsx.jsx
  - Imports expect ../components/UnitDetailsDrawer.jsx (single .jsx). This mismatch will break admin drawers.
- client/src/admin/InventoryChangeHistory.jsx.jsx
  - Router imports InventoryChangeHistory.jsx (single .jsx).
- client/src/admin/InventoryChanges.jsx.jsx
  - Router imports InventoryChanges.jsx (single .jsx).

Findings — present but currently unused in routes
- client/src/components/dashboards/SalesManagerDashboard.jsx
- client/src/components/dashboards/SalesRepDashboard.jsx
- client/src/components/notifications/NotificationCenter.jsx

Back-end legacy/unused
- api/server.js (compose and scripts run src/index.js). Keep as legacy starter, but it is not used by the dev stack.

What works well
- useCalculatorSnapshot and CreateDeal.jsx integration to prefill and extract calculator state.
- Payment schedule export (CSV/XLSX) and checks-sheet generator.
- Codespaces-compatible HMR and API URL wiring.

Recommended actions (future task list)
- File hygiene
  - Rename the three double-extension files to single .jsx to match imports and prevent runtime errors.
- Refactor App.jsx (behavior must remain identical)
  - Extract buildPayload and validateForm into client/src/lib/calculatorHelpers.js.
  - Extract comparison calculations into a hook: client/src/lib/useCalculatorComparison.js.
  - Keep App.jsx focused on composing UI and delegating logic.
- Optional wiring
  - If dashboards are desired now, add routes and minimal API stubs; otherwise mark as “future” and leave untouched.
  - Wire NotificationCenter to notifications API or keep as “future module.”
- DX/Quality
  - Add ESLint + Prettier to catch duplicate declarations and file mismatches earlier.
  - Consider TypeScript for types on calculator payloads and API responses (incremental).
- Documentation
  - Maintain this section (Calculator Modularity Audit) and “Recent Fixes and Changes” for every session.
  - When renaming files or refactoring, summarize exactly what moved and why.

No deletions were done in this audit.

---

## AI/Agent Contribution Rules

Any automated agent (AI or script) committing changes MUST:
1) Update this README in the “Recent Fixes and Changes” section with a concise bullet list of what changed and why.
2) If developer experience changes (ports, env, run steps), update the corresponding sections.
3) If new endpoints, routes, or commands are added, document them briefly under API Reference or a new section.
4) Keep instructions accurate for both local Docker and Codespaces.
5) Do not remove existing notes; append and refine.
6) Prefix every new bullet in “Recent Fixes and Changes” with a timestamp in the form [YYYY-MM-DD HH:MM] (UTC).

Checklist before finishing any task:
- [ ] Code builds and runs locally (docker compose up -d) or in Codespaces
- [ ] Ports are correct and forwarded
- [ ] README updated with the changes
- [ ] README entry is timestamped [YYYY-MM-DD HH:MM] (UTC) in “Recent Fixes and Changes”
- [ ] Commit message references what was updated in README

---
