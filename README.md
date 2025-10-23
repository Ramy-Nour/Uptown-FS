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
- [2025-10-23 14:30] API route mounts and health endpoints restored:
  - API: Reintroduced core middleware (helmet, cors, express.json/urlencoded) and mounted primary routers in api/src/app.js:
    - /api/auth, /api/deals, /api/units, /api/inventory, /api/standard-plan, /api (planningRoutes), /api/notifications, and /api/blocks.
  - API: Added GET /api/health → { status: "ok" } and GET /api/message → { message: "Hello from API" } for Codespaces reachability checks.
  - Impact: Client calls like POST /api/blocks/request now resolve to the correct Express router instead of returning 404/500 due to missing mounts. Body parsing is enabled so validation works as expected.
- [2025-10-23 15:05] NPV tolerance tightened to 2%:
  - API: Updated evaluation tolerance in api/src/planningRoutes.js from 70% to 98% baseline, i.e., Proposed PV must be ≥ 98% of Standard PV to PASS (epsilon applied).
  - Note: The evaluation PV shown in “Acceptance Evaluation” is authoritative; smaller “Std Calculated PV” boxes are client estimates and may differ if inputs don’t match.
- [2025-10-23 14:40] Maintenance Deposit month default — treat empty string or 0 as “not provided”:
  - API: In plan generation (api/src/planningRoutes.js), if maintenancePaymentDate is not given and maintenancePaymentMonth is '' or 0, we now fallback to HandoverYear × 12; if handoverYear is not set, fallback to 12 months. Previously, an empty string coerced to 0 so Maintenance showed at month 0 (same date as Down Payment).
  - Tests: Added unit tests for the helper in api/src/tests/paymentPlanHelpers.test.js. Run with: cd api && npm run test:helpers
  - Result: Maintenance Deposit date defaults to Handover (or 12 months) unless an explicit month (> 0) or a calendar date is provided.
- [2025-10-23 09:10] Maintenance Deposit default date — honor Handover year when date is empty:
  - Client: Fixed payload construction so an empty Maintenance Deposit Month is not treated as 0. When the Maintenance Deposit Date is empty, we now default the due month to handoverYear × 12; if handoverYear is not set, we fall back to 12 months. Previously, an empty string coerced to 0 and the schedule placed Maintenance at month 0 (same as First Payment Date).
  - API: No change required. The server already defaults to Handover when month is invalid; the client now sends the correct month when the date is omitted.
- [2025-10-23 09:15] Unit Block internal error (500) — ensure blocks table exists:
  - DB: Added migration 041_blocks_table.sql to create the blocks table with required columns and indexes. Some environments relied on initDb but had migrations drift; this guarantees the table and trigger exist so /api/blocks/request no longer returns 500 due to missing relation.
- [2025-10-23 09:35] Blocked-unit edit rules and Reservation Form flow:
  - Client: When a unit is blocked (approved), property_consultant cannot edit client identity fields (name, email, phone) and cannot edit Unit & Project Information. Consultants can still adjust the payment plan and other client fields (e.g., address).
  - Client: Financial Admin sees blocked units and can generate the Reservation Form using the data previously entered by the consultant (buyers, unit, and payment plan). FA cannot edit these fields directly; they should request edits from the consultant via workflow (future enhancement to add explicit “Request Edits” action).
  - Client: App now passes blocked_until/available through unitInfo and computes unitBlocked to drive field-level locks.
- [2025-10-23 10:25] Full Override Workflow (Consultant → SM → FM → TM) with notifications and audit:
  - Client: Consultant can request override when Evaluation is REJECT on Deal Detail; the panel shows the workflow stages and provides role-based actions for SM, FM, and TM (Approve/Reject) with optional notes.
  - Client: Added a visual timeline (sample circles) with dimmed pending stages and orange line/circle for approved stages. Stages show timestamps when completed.
  - API: Notifications added for each decision stage:
    - SM Approve → notify consultant “override_sm_approved”; SM Reject → “override_sm_rejected”.
    - FM Approve → “override_fm_approved”; FM Reject → “override_fm_rejected”.
    - TM Approve → “override_approved”; TM Reject → “override_rejected” (includes role in message).
  - API: All actions write structured entries to deal_history with timestamps and user roles. Rejections clear needs_override and return the decision to consultant with audit trail.
  - Client: Approvals page remains focused on deal approvals; override is handled in Deal Detail with role-specific buttons.
- [2025-10-23 10:35] Unit Block button activation policy:
  - Client: Consultant can request a unit block only when the plan is accepted by the automated system (NPV evaluation PASS) or when an override is approved (Top Management approval present). The button is disabled otherwise with a tooltip explaining the condition.
  - Client: Create Deal page also disables the “Request Unit Block” button until the plan evaluation is ACCEPT.
- [2025-10-23 11:22] Reservation Form — Arabic/RTL support and in-app modal UX:
  - API: /api/documents/reservation-form now supports 'language' ('en'|'ar'), RTL rendering, localized labels and day-of-week, plus 'currency_override'.
  - Client: Deal Detail shows a modal for Financial Admin to choose:
    - Reservation Date (date picker)
    - Preliminary Payment (validated numeric)
    - Currency override (optional)
    - Language (English/Arabic with RTL)
    Then calls the API to generate and download the PDF. Button remains disabled until Financial Manager approval (fm_review_at).

- [2025-10-23 11:40] Backend refactor — modular documents and planning endpoints, plus jobs and schema checks:
  - Created api/src/documentsRoutes.js and mounted at /api/documents:
    - POST /api/documents/client-offer
    - POST /api/documents/reservation-form
  - Created api/src/planningRoutes.js and mounted at /api:
    - POST /api/calculate
    - POST /api/generate-plan
  - Moved background schedulers to api/src/jobs/scheduler.js and started from app.js via startSchedulers().
  - Moved schema check utilities to api/src/utils/schemaCheck.js; app.js imports runSchemaCheck and retains /api/schema-check and startup check.
  - Carefully removed legacy inline route blocks from app.js:
    - Removed the old Client Offer and Reservation Form endpoints now served by documentsRoutes.
    - Removed the old /api/calculate and /api/generate-plan endpoints now served by planningRoutes.
  - If rollback is needed:
    - Reintroduce the removed blocks from git history, or temporarily comment out the new mounts and re-enable the inline routes in app.js.
    - Alternatively, disable the scheduler import in app.js and re-enable the in-file setInterval blocks.

- [2025-10-23 11:41] Frontend refactor — modal component extraction:
  - Added client/src/components/ReservationFormModal.jsx and wired it in DealDetail.jsx.
  - The modal handles: date picker, preliminary payment validation, currency override, language toggle (English/Arabic).
  - DealDetail now uses the component and calls the server endpoint to generate the PDF.

- [2025-10-23 11:55] Backend refactor — notifications endpoints modularized:
  - Created api/src/notificationsRoutes.js and mounted at /api/notifications:
    - GET /api/notifications
    - GET /api/notifications/unread-count
    - PATCH /api/notifications/:id/read
    - PATCH /api/notifications/mark-all-read
  - Removed the old inline notifications endpoints from app.js and replaced with the module mount.
  - Rollback guidance:
    - If needed, re-enable the inline endpoints from git history and comment out app.use('/api/notifications', notificationsRoutes).
    - Alternatively, keep the mount and copy routes back into app.js temporarily to test; then remove duplicates once stable.

- [2025-10-23 12:05] Frontend refactor — App.jsx modularization (step 1):
  - Extracted DiscountHint into client/src/components/DiscountHint.jsx and imported in App.jsx.
  - Extracted TypeAndUnitPicker into client/src/components/TypeAndUnitPicker.jsx for cleaner unit/type selection logic (currently not directly used if UnitInfoSection encapsulates selection).
  - App.jsx imports the new components to reduce inline function size and improve readability.
  - Rollback guidance:
    - If any UI breaks, revert imports in App.jsx and restore the inline DiscountHint/TypeAndUnitPicker implementations from git history.
    - Components are self-contained; you can delete the new files and the app will work once inline code is restored.

- [2025-10-23 12:20] Frontend refactor — App.jsx modularization (step 2: exports utils):
  - Created client/src/lib/docExports.js and moved:
    - exportScheduleCSV(genResult, language)
    - exportScheduleXLSX(genResult, language)
    - generateChecksSheetXLSX(genResult, clientInfo, unitInfo, currency, language)
  - App.jsx now imports these helpers and calls them from the buttons.
  - Benefits: reduces App.jsx size and isolates export logic for reuse.
  - Rollback guidance:
    - If needed, delete client/src/lib/docExports.js and restore the original inline functions in App.jsx from git history.
    - Temporarily you can copy the functions back into App.jsx while keeping imports commented to test UI, then remove duplicates once stable.

- [2025-10-23 12:32] Frontend refactor — App.jsx modularization (step 3: Client Offer generation helper):
  - Extended client/src/lib/docExports.js with generateClientOfferPdf(body, API_URL, onProgress?).
  - App.jsx now calls generateClientOfferPdf and handles the returned blob+filename to download the PDF.
  - Benefits: progress/notification logic centralized; App.jsx smaller and easier to read.
  - Rollback guidance:
    - If needed, remove generateClientOfferPdf from docExports.js and reinsert the original exportClientOfferPdf function into App.jsx from git history.
    - Comment out the import in App.jsx and call the inline function; once stable, remove duplicates.

- [2025-10-23 12:45] Frontend refactor — App.jsx modularization (step 4: hooks + persistence):
  - Added client/src/hooks/useCalculatorSummaries.js and replaced the in-file useMemo with useCalculatorSummaries(preview).
  - Added client/src/hooks/useComparison.js and replaced the in-file useMemo with useComparison({ stdPlan, preview, inputs, firstYearPayments, subsequentYears, genResult, thresholdsCfg }).
  - Added client/src/hooks/useCalculatorPersistence.js:
    - loadSavedCalculatorState(LS_KEY) used to hydrate the calculator state on mount.
    - usePersistCalculatorState(LS_KEY, snapshot) used to persist state changes (snapshot built via useMemo).
  - App.jsx now imports and uses these hooks, reducing in-file logic and improving readability.
  - Rollback guidance:
    - If needed, delete the new hooks and restore the original useMemo blocks and localStorage effects from git history.
    - Temporarily reintroduce the inline logic while keeping imports commented out to test, then remove duplicates when stable.

- [2025-10-23 12:46] Frontend refactor — services layer (calculator API):
  - Added client/src/services/calculatorApi.js with:
    - fetchLatestStandardPlan(API_URL)
    - calculateForUnit({ mode, unitId, inputs }, API_URL)
    - generatePlan(payload, API_URL)
  - Wired TypeAndUnitPicker to use calculateForUnit service instead of direct fetchWithAuth for unit-based calculations.
  - Rollback guidance:
    - If any API code breaks, call fetchWithAuth directly as before, and remove the service import.

- [2025-10-23 12:58] Frontend refactor — App.jsx document generation via helper:
  - Extended client/src/lib/docExports.js with generateDocumentFile(documentType, body, API_URL) which wraps /api/generate-document and returns { blob, filename }.
  - App.jsx now uses generateDocumentFile in the Reservation Form and Contract buttons:
    - Builds document body with existing buildDocumentBody(documentType).
    - Calls generateDocumentFile and triggers the download.
  - Rollback guidance:
    - If needed, remove the import and restore the original generateDocument(documentType) function from git history.
    - Alternatively, call fetchWithAuth inline and parse Content-Disposition as previously done.

- [2025-10-23 13:08] Frontend refactor — App.jsx modularization (step 5: buildDocumentBody util + service wiring):
  - Added client/src/lib/buildDocumentBody.js and replaced inline builder in App.jsx:
    - buildDocumentBody(documentType, { language, currency, clientInfo, unitInfo, stdPlan, genResult, inputs }) returns { buyers, data } for the document.
    - App.jsx now validates via validateForm(), builds payload, and merges docPart into the request body before calling generateDocumentFile.
  - Wired App.jsx to services:
    - Standard Plan fetch now uses fetchLatestStandardPlan(API_URL) from client/src/services/calculatorApi.js.
    - Plan generation now uses generatePlan(payload, API_URL) instead of direct fetchWithAuth.
  - Rollback guidance:
    - If needed, delete client/src/lib/buildDocumentBody.js and restore the original buildDocumentBody function in App.jsx from git history.
    - Revert service imports and switch back to fetchWithAuth calls for /api/standard-plan/latest and /api/generate-plan.

- [2025-10-23 13:20] Frontend refactor — App.jsx modularization (step 6: payload + validation + system services):
  - Added client/src/lib/payloadBuilders.js:
    - buildCalculationPayload({ mode, stdPlan, unitInfo, inputs, firstYearPayments, subsequentYears }) centralized payload assembly.
  - Added client/src/lib/validateCalculatorInputs.js:
    - validateCalculatorInputs(payload, inputs, firstYearPayments, subsequentYears) returns an errors object, replacing inline validation checks.
  - App.jsx updates:
    - Replaced inline buildPayload with buildCalculationPayload import.
    - Replaced validation logic with validateCalculatorInputs while keeping date defaulting locally (offerDate/firstPaymentDate).
    - Fixed import for buildDocumentBody (typo corrected).
    - Snapshot exposure now uses buildCalculationPayload for consistency.
  - Added client/src/services/systemApi.js and wired App.jsx:
    - fetchHealth(API_URL), fetchMessage(API_URL) used for initial health/message loading.
  - Rollback guidance:
    - If needed, delete payloadBuilders.js and validateCalculatorInputs.js and reinsert the original buildPayload and validateForm from git history.
    - Revert systemApi imports and switch back to fetchWithAuth directly for /api/health and /api/message.

- [2025-10-23 13:30] Frontend refactor — App.jsx modularization (step 7: styles + dynamic payments handlers):
  - Added client/src/styles/calculatorStyles.js and moved the big styles object out of App.jsx. App.jsx now imports styles from this file.
  - Added client/src/hooks/useDynamicPayments.js encapsulating:
    - addFirstYearPayment, updateFirstYearPayment, removeFirstYearPayment
    - addSubsequentYear, updateSubsequentYear, removeSubsequentYear
    App.jsx imports and uses the hook to reduce inline handler boilerplate.
  - Result: App.jsx line count reduced further without changing behavior.
  - Rollback guidance:
    - If needed, remove the styles import and paste the original styles object back into App.jsx from git history.
    - Delete useDynamicPayments.js and restore the handler functions inline in App.jsx.

- [2025-10-23 13:42] Frontend refactor — App.jsx modularization (step 8: unit search + embedding APIs):
  - Added client/src/hooks/useUnitSearch.js and replaced the inline debounced typeahead effect with this hook.
    - Provides: unitsCatalog, unitQuery, unitSearchLoading, unitDropdownOpen, setUnitQuery, setUnitDropdownOpen.
  - Added client/src/hooks/useCalculatorEmbedding.js and replaced the long window.__uptown_calc_* useEffect with this hook.
    - Exposes getSnapshot, applyClientInfo, applyUnitInfo, applyUnitPrefill for embedding contexts.
  - Fixed minor import typos and cleaned duplicated snapshot lines.
  - Result: App.jsx line count reduced to approximately ~1260 lines.
  - Rollback guidance:
    - If needed, remove the hook imports and reinsert the original unit search effect and embedding useEffect from git history.
    - Ensure any removed state variables are re-added if rolling back (unitsCatalog/unitQuery/etc.).

- [2025-10-23 13:52] Frontend refactor — App.jsx modularization (step 9: acceptance thresholds hook + Custom Notes component):
  - Added client/src/hooks/useAcceptanceThresholds.js and replaced the inline acceptance thresholds fetch/useEffect.
    - App.jsx now calls const thresholdsCfg = useAcceptanceThresholds() and uses it in comparison/evaluation.
  - Added client/src/components/calculator/CustomNotesSection.jsx and replaced the inline custom notes section.
    - Props: styles, language, role, customNotes, setCustomNotes.
    - Behavior identical; just modularized.
  - App.jsx imports these for cleaner structure. Line count reduced further (~1170 lines).
  - Rollback guidance:
    - If needed, remove the hook/component imports and paste back the original inline useEffect and custom notes JSX from git history.
    - Ensure state bindings (customNotes/setCustomNotes and thresholdsCfg) are restored when rolling back.

- [2025-10-23 14:05] Frontend cleanup — App.jsx fixes and styles polish:
  - Removed inline duplicate TypeAndUnitPicker definition from App.jsx (the component already exists in client/src/components/TypeAndUnitPicker.jsx).
  - Restored a small buildPayload() wrapper in App.jsx that delegates to buildCalculationPayload(...) to maintain compatibility with InputsForm prop usage.
  - Fixed acceptance thresholds hook usage after refactor (useAcceptanceThresholds now correctly assigned to thresholdsCfg).
  - Styles: corrected a syntax error in client/src/styles/calculatorStyles.js (td.borderBottom had mismatched quotes) and added styles.arInline used by CustomNotesSection.
  - Rollback guidance:
    - If needed, reinsert the inline TypeAndUnitPicker block from git history and remove the component import.
    - If InputsForm requires a different payload shape, adjust buildPayload() accordingly or revert to the original inline builder.
    - If styling regressions occur, revert calculatorStyles.js to its prior version from git history.
- [2025-10-21 07:20] Standard Pricing approval — propagate to unit:
  - API: On approving a Standard Pricing record, the server now propagates the approved price (and area when valid) to the related unit (units.base_price and optionally units.area), and logs a 'propagate' entry in standard_pricing_history. This mirrors the unit-model pricing propagation pattern and ensures approved standards immediately reflect on the unit.
- [2025-10-21 07:05] Top-Management approvals for Standard Pricing:
  - API: Updated /api/workflow/standard-pricing/:id/approve and /reject to allow Chairman and Vice Chairman in addition to CEO. Previously, only CEO could approve/reject, which blocked Top Management when other roles attempted to act. This change makes approvals applicable regardless of the unit’s linkage to a Standard Price record.
- [2025-10-21 06:35] Client Offer PDF — consultant name reliability:
  - API: Simplified consultant identity resolution to rely strictly on users.name and users.email. We initialize from the authenticated user context and, if a deal_id is provided, prefer the deal creator from DB. Fallback reads the current user from DB using name/email columns only. This ensures the consultant’s name appears in the PDF whenever it’s present in the users table.
- [2025-10-21 06:25] Consultant UX — export buttons visibility and Unit Block section placement:
  - Client: PaymentSchedule export buttons (XLSX/CSV/Checks) are now visible only to financial_admin; they are hidden for property_consultant and sales_manager while keeping the functionality available under the admin role.
  - Client: Moved the Unit Block/Unit Info section to the end of the page (below the schedule) to improve perceived streaming and page flow.
- [2025-10-21 06:10] Client Offer PDF — performance, Arabic reliability, and UI improvements:
  - API: Reuse a singleton Puppeteer browser instance and switch setContent waitUntil to 'load' to reduce export latency and avoid intermittent stalls on Arabic PDFs behind sandboxed environments.
  - API: Unit totals box now shows dual totals — excluding Maintenance Deposit and including Maintenance Deposit — to align with the payment plan totals presentation.
  - Client: Export button for Property Consultant now shows a progress indicator (%) while the PDF is generated. Progress ramps to completion when the file is ready and the button is disabled during processing.
  - Client: Added Maintenance Deposit inputs (Amount and optional Date) in the consultant Inputs panel. If date is omitted, the API defaults the maintenance due to the Handover date. The generated plan now consistently includes the Maintenance Deposit row when an amount is present.
- [2025-10-21 05:10] Backend stability and schema alignment:
  - Fixed a server crash in Client Offer PDF totals block by adding explicit parentheses around mixed ?? and || expressions in template strings.
  - Adjusted consultant name lookup to rely on users.name and users.email only (no first_name/last_name columns required). If users.name is empty, the PDF falls back to the authenticated user's name or finally to email.
- [2025-10-21 05:05] Codespaces/CORS/Ports guide (Docker):
  - Added a Troubleshooting section with exact commands for Docker Compose, Codespaces port visibility, curl preflight (OPTIONS) checks, and how to set CORS_ORIGINS correctly when needed.
  - Clarified that our API CORS layer already allows *.app.github.dev unless CORS_ORIGINS is explicitly set (then it becomes a strict allow-list).
- [2025-10-21 05:00] CSV/XLSX/PDF nullish coalescing fixes:
  - Updated client (App.jsx) and server (app.js) to wrap nullish coalescing expressions mixed with logical OR to keep Babel/Node parsers happy.

- [2025-10-20 23:55] Client Offer PDF — Unit totals box:
  - API: /api/documents/client-offer now renders a unit totals table (Unit Type, Price, Garden, Roof, Storage, Garage, Maintenance Deposit, Total). Optional rows are shown only when > 0; labels localized EN/AR.
  - Client: exportClientOfferPdf sends unit_pricing_breakdown derived from the selected unit.
- [2025-10-20 23:45] Dual totals everywhere (incl./excl. Maintenance Deposit):
  - API: /api/generate-plan totals now include totalNominalIncludingMaintenance and totalNominalExcludingMaintenance (totalNominal preserved for compatibility).
  - Client: PaymentSchedule footer shows both totals; CSV/XLSX exports append both; Client Offer PDF totals block shows both (localized).
- [2025-10-20 23:35] Client Offer PDF — Consultant identity and footer:
  - Consultant label localized to “Property Consultant” / “المستشار العقاري”.
  - Name resolution improved: falls back to req.user first_name/last_name or name when DB lacks names; email still shown.
  - Footer shows page numbering: “Page X of Y” / “صفحة س من ص”.
- [2025-10-20 23:20] Maintenance Deposit terminology and scheduling:
  - Renamed “Maintenance Fee” to “Maintenance Deposit” throughout schedule/UI (Arabic: وديعة الصيانة).
  - Default due date equals Handover date when month is not provided.
  - New optional maintenancePaymentDate supported (calendar date overrides month offset).
  - Acceptance calculations exclude Maintenance Deposit from cumulative totals.
- [2025-10-20 23:00] Acceptance Evaluation and Standard PV baseline:
  - Standard PV in /api/generate-plan is now computed via the central engine including the current request’s Down Payment definition to match Proposed PV when using the same plan.
  - PV rule fixed: Proposed PV passes when ≥ Standard PV (within tolerance/epsilon).
- [2025-10-20 22:45] Arabic words everywhere:
  - PaymentSchedule already showed Arabic words when language='ar'.
  - CSV/XLSX exports now write Arabic words when exporting in Arabic.
  - Client Offer PDF always renders amount-in-words in the requested language (ignores client-provided wording to avoid mismatches).
- [2025-10-20 22:30] DP handling and mode defaults:
  - Target-PV modes now convert DP% to a fixed amount on mode switch (computed from the current Standard Total Price) to avoid “20% → 20 EGP” errors.
  - Consultant default mode changed to “Discounted Standard Price (Compare to Standard)”.
- [2025-10-20 22:10] Standard Pricing — PV alignment:
  - Table rows now request PV from the central calculator with the user’s current DP% included (previously sent 0%).
  - The table recomputes PV when DP% changes so PV in the form and list match.
- [2025-10-19 05:30] GitHub Actions: On-demand database backups:
  - Added .github/workflows/db-backup.yml with workflow_dispatch inputs: mode {logical|bundle}, release {true|false}.
  - logical: Runs pg_dump using secrets.DATABASE_URL and uploads a gzipped SQL artifact; optional GitHub Release created.
  - bundle: Archives the repo’s backups/ directory and uploads as artifact; optional GitHub Release created.
  - README: Documented usage and required secret (DATABASE_URL) format.
- [2025-10-19 05:15] DB backup/restore convenience commands:
  - package.json: Added npm scripts `db:backup` and `db:restore` to run the volume backup and restore scripts without typing full paths.
  - scripts/db_volume_restore.sh: If filename arg is omitted or incorrect, the script now lists available backups from backups/*.tar.gz and shows usage examples.
  - README: Updated “Database Backup and Restore” with npm convenience commands and note about auto-listing backups on restore.
- [2025-10-19 05:00] DB volume backup/restore scripts:
  - Added scripts/db_volume_backup.sh to archive the db_data Docker volume to backups/db_data-YYYYMMDD-HHMMSS.tar.gz (UTC timestamp).
  - Added scripts/db_volume_restore.sh to restore the db_data volume from a tar.gz archive. Documented usage and cautions (stop db before, version compatibility).
  - README: Added “Database Backup and Restore (db_data volume)” section with instructions for physical volume backup/restore and optional pg_dump/psql commands for logical backups.
- [2025-10-19 04:40] Server-rendered Client Offer PDF (Puppeteer):
  - API: Added POST /api/documents/client-offer (role: property_consultant). Generates a PDF from server-rendered HTML with buyers[] (phones/emails), payment schedule, totals, dates, and optional unit info. Supports Arabic/English.
  - Infra: Added puppeteer dependency and installed Chromium in API Dockerfile (development and production). Set PUPPETEER_EXECUTABLE_PATH; added fonts for Arabic rendering.
  - Client: Added “Export Client Offer (PDF)” button in Calculator Payment Schedule panel for property_consultant only. It posts current buyers, schedule, totals, dates, and unit summary to the new endpoint and downloads the PDF.
  - Note: Reservation Form remains mapped to Pricing Form G.docx (financial_admin); Contract uses Uptown Residence Contract.docx (contract_person). Exports (CSV/XLSX/Checks) remain visible only to financial_admin.
- [2025-10-19 04:05] Client-side route guard added:
  - New component client/src/components/RequireRole.jsx to enforce per-route role access. Unauthorized users are redirected to /deals (fallback configurable).
  - Applied to /deals/block-requests allowing roles: sales_manager, property_consultant, financial_manager.
  - Purpose: Begin enforcing UI-level access control consistently; server-side auth remains authoritative.
- [2025-10-19 03:55] Sales Manager team scoping for pending Block Requests:
  - API: GET /api/blocks/pending now restricts Sales Manager view to requests initiated by consultants in their team, using sales_team_members (manager_user_id → consultant_user_id). Consultants see only their own; Financial Managers see all.
  - Purpose: Ensure SMs only manage requests from their direct team.
- [2025-10-19 03:45] FM approval actions in Block Requests queue:
  - UI: For Financial Managers, /deals/block-requests now shows Approve/Reject buttons per request (inline). It uses PATCH /api/blocks/:id/approve with action approve|reject and optional reason prompt. Requests are removed from the list after decision.
  - Purpose: Allow FM to process unit block approvals directly from the queue.
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

## Database Backup and Restore (db_data volume)

Two scripts are provided to back up and restore the Postgres data volume (physical files). Physical volume backups are fast but are tied to the Postgres major version. For portability across versions, prefer logical dumps (pg_dump).

Important
- For maximum consistency, stop the db container before a volume backup or restore:
  - docker compose stop db
- After restore, start the db container:
  - docker compose up -d db

Convenience commands (npm)
- Backup: npm run db:backup
- Restore: npm run db:restore -- backups/db_data-YYYYMMDD-HHMMSS.tar.gz
  - If you omit the filename, the restore script will list available backups from backups/*.tar.gz.

Create a volume backup (tar.gz)
- scripts/db_volume_backup.sh
  - Creates backups/db_data-YYYYMMDD-HHMMSS.tar.gz in the repo
  - Usage: scripts/db_volume_backup.sh [backup_dir]
  - Example: scripts/db_volume_backup.sh
  - Output file: backups/db_data-20251019-050000.tar.gz (UTC timestamp)

Restore from a volume backup
- scripts/db_volume_restore.sh <path/to/db_data-YYYYMMDD-HHMMSS.tar.gz>
  - WARNING: Deletes current contents of db_data and replaces with archive
  - Example: scripts/db_volume_restore.sh backups/db_data-20251019-050000.tar.gz

Notes
- Physical volume backups/restores assume the same Postgres major version (here: 16).
- If you need cross-version migration or fine-grained selection, use pg_dump/psql:
  - docker exec -t app_db pg_dump -U appuser -d appdb > backups/appdb-YYYYMMDD.sql
  - cat backups/appdb-YYYYMMDD.sql | docker exec -i app_db psql -U appuser -d appdb

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

### Docker/Codespaces — Reachability & CORS checklist

1) Verify containers and published ports
- docker compose ps
- docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  - Expect API to publish 3001 on the host (e.g., 0.0.0.0:3001->3000/tcp).

2) Ensure Codespaces ports are public
- gp ports list
- gp ports visibility 3001:public
- gp ports visibility 5173:public

3) Make sure client uses the correct API URL
- In Codespaces, the API URL is:
  - https://<your-codespace>-3001.app.github.dev
- The client reads VITE_API_URL. Set it if needed:
  - echo 'VITE_API_URL="https://<your-codespace>-3001.app.github.dev"' >> client/.env
  - docker compose up -d --build client

4) Test API from inside API container (confirms app is running)
- docker compose exec app_api sh -lc 'apk add --no-cache curl 2>/dev/null || true; curl -i http://127.0.0.1:3000/api/health'
  - Expect 200 OK

5) Test API from Codespaces host (confirms port forwarding)
- export API_HOST="<your-codespace>-3001.app.github.dev"
- curl -i https://$API_HOST/api/health
  - Expect 200 OK. If 502, check port mapping (compose) and that app listens on 0.0.0.0 in container.

6) Validate CORS (only meaningful after 200 OK)
- export FE_ORIGIN="https://<your-codespace>-5173.app.github.dev"
- Preflight:
  curl -i -X OPTIONS "https://$API_HOST/api/health" \
    -H "Origin: $FE_ORIGIN" \
    -H "Access-Control-Request-Method: GET"
- Actual:
  curl -i "https://$API_HOST/api/health" -H "Origin: $FE_ORIGIN"

By default, our CORS layer allows *.app.github.dev. If you explicitly set CORS_ORIGINS, it becomes a strict allow-list. Include your FE origin when setting CORS_ORIGINS:
- In docker-compose.yml (API service):
  environment:
    - CORS_ORIGINS=https://<your-codespace>-5173.app.github.dev,http://localhost:5173

Then rebuild:
- docker compose up -d --build

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

## User Guide — Pages, Flows, and Actions

This section describes how each primary page works, who can use it, and the key buttons and actions available. Use this as a quick help reference per role. Links and labels are given as they appear in the app.

General notes
- Roles: property_consultant, sales_manager, financial_admin, financial_manager, contract_person, admin/superadmin (admin pages).
- Date pickers accept calendar dates; if a date is optional and left empty, defaults are applied as documented (e.g., Maintenance Deposit defaults to the Handover date).
- The app supports English and Arabic. Toggle “Language for Written Amounts” in Calculator to affect number-to-words output.

1) Calculator Page
- Purpose: Build payment plans, evaluate acceptance, prepare client offer exports.
- Who: All roles can view; some inputs are locked based on role.
- Key inputs
  - Offer Date and First Payment Date: required; First Payment defaults to Offer Date.
  - Mode: choose calculation mode (four options with inline explanations).
  - Down Payment Type: “percentage” is disabled in PV-target modes to avoid circular dependency.
  - Installment Frequency and Plan Duration (years): required.
  - Handover Year and Additional Handover Payment: optional; if amount > 0 and year > 0, “Handover” appears in schedule.
  - Maintenance Deposit (Amount + optional Date): not part of PV; if date is empty, it defaults to Handover.
- Buttons
  - Calculate (Generate Plan): builds the schedule and shows acceptance evaluation.
  - Export Client Offer (PDF): Property Consultant only; shows a progress bar during generation.
  - Export CSV / Export XLSX / Generate Checks Sheet: Financial Admin only; disabled for other roles.
- Results
  - Payment Schedule table with Month/Label/Amount/Date/Written Amount.
  - Totals box shows both “Total (excluding Maintenance Deposit)” and “Total (including Maintenance Deposit)”.
  - Acceptance Evaluation (server-side) shows PV comparison, conditions, and decision.

2) Deals → Create Deal
- Purpose: Prepare a full deal record using the embedded calculator and selected unit.
- Who: Consultants/Sales Managers prepare; downstream actions by managers/admins.
- Flow
  - Select a unit from Inventory (or arrive with unit_id in URL). Unit summary shows model, code, prices, and totals.
  - Use the embedded Calculator to generate a Payment Plan.
  - Required minimal fields: Client Name, Client Primary Phone, Unit Model, Unit Code or Unit Number.
- Buttons
  - Change Unit: navigates back to Inventory.
  - Request Unit Block: Consultants/Sales Managers can request a temporary hold (block) on the unit.
  - Save as Draft: creates a draft deal.
  - Save and Submit: creates and submits the deal; requires a generated plan.
- Errors
  - “Please generate a payment plan before submitting.” if plan missing.
  - “Missing required fields: …” for minimal fields not supplied.

3) Deals → Block Requests
- Purpose: Manage pending unit block requests.
- Who:
  - Property Consultant: sees only their own pending requests; can cancel own.
  - Sales Manager: sees requests from consultants in their team; can cancel any pending.
  - Financial Manager: sees all pending requests; can approve or reject inline.
- Buttons per request row
  - Approve / Reject (FM only): PATCH /api/blocks/:id/approve with action approve|reject.
  - Cancel: Consultant (own only) or Sales Manager (any pending).
- Outcomes
  - Approve: unit becomes unavailable; block listed under “Current Blocks”.
  - Reject/cancel: request removed from pending list.

4) Inventory (Deals → Inventory)
- Purpose: Browse and select units for a deal.
- Who: Consultants/Sales Managers/Financial Managers.
- Actions
  - Filter/search: type ahead to find units.
  - Select unit: navigates to Create Deal with unit prefilled.
- Notes
  - If inventory appears in Admin pages but not under Deals → Inventory, ensure pricing drafts are linked to a Unit Model and approved, and units are AVAILABLE.

5) Dashboard (Deals → Dashboard)
- Purpose: Overview of deals and proposals with key dates.
- Who: All roles; sections vary by role.
- Columns
  - Offer Date, First Payment Date, decision status, totals.
- Exports
  - CSV/XLSX exports include Offer Date and First Payment Date.

6) Admin Pages (various)
- Purpose: Configuration, pricing, approvals, thresholds.
- Who: financial_admin, financial_manager, contract_person, admin/superadmin.
- Examples
  - Standard Pricing: configure per-model nominal components; approve to propagate to units (base price, area).
  - Standard Plan: configure annual rate, duration, frequency; becomes authoritative baseline.
  - Acceptance Thresholds: update min/max percentages; evaluated server-side in plans.

7) Documents
- Client Offer (PDF)
  - Who: Property Consultant
  - Button: Export Client Offer (PDF) from Calculator page.
  - Content: buyers list, schedule table, totals, optional unit summary box with breakdown and dual totals. Arabic/RTL supported; page footers show Page X of Y.
- Reservation Form
  - Who: Financial Admin
  - Button: Generate Reservation Form (from Calculator page when role permitted).
- Contract
  - Who: Contract Person
  - Button: Generate Contract (from Calculator page when role permitted).
- Notes: Supported templates live under api/templates; placeholders use <<name>>. Numeric fields gain “*_words” automatically.

8) Notifications
- Financial Managers receive notifications for block requests, hold reminders/expiry events.
- Consultants receive notifications for decisions on their block requests.

Troubleshooting quick tips
- If a button is disabled, check role permissions.
- For CORS/API reachability in Codespaces, see the Troubleshooting section below.
- If a unit block request returns an error, ensure the unit is AVAILABLE and that the blocks table exists (migrations run automatically on startup).

---

## Roadmap (next sessions)

Planned enhancements
- Override Timeline UI refinements
  - Improve visuals: larger circles, labels under nodes, responsive layout, and hover tooltips with timestamps and approver names.
  - Show the same override timeline on the Sales Manager Approvals page (implemented initial compact timeline badge).
- Unit Lifecycle Timeline (future)
  - Add a similar timeline to track unit state across Blocked → Reserved → Contracted (and back if expired/unblocked).
  - Integrate with blocks table and reservation/contract events to display timestamps per transition.
- Contract Cancellation Flow (future)
  - Design and implement contract cancellation workflow with approvals and audit trail.
  - Update documents and notifications to reflect cancellation and unit state changes.

- Polish Client Offer PDF (server-rendered):
  - Add branded header/logo, consistent typography, page headers/footers, and proper pagination (repeat table headers on page break).
  - Improve RTL/Arabic typography and spacing; verify Noto Arabic fallback coverage.
  - Add multi-language labels, currency formatting, optional unit summary block, and a configurable disclaimer.
  - Source logo from VITE_COMPANY_LOGO_URL or client/public/logo/* with fallback.
- Add UI-level access guards project-wide:
  - Hide block/unblock related links, buttons, and pages from admin/superadmin across all screens (Dashboard, Create Deal, Inventory, queues, etc.).
  - Keep server-side authorization as the source of truth; UI guards are UX hardening.
  - Introduce a standard “Access Denied” page and wire RequireRole to render it as a fallback (instead of redirect) for unauthorized visits.
  - Implement after current feature set is finalized, and test per role.
- Reintroduce OCR into the Client Information flow incrementally (start from archived ClientInfoForm_OCR.jsx), keeping typing stability. Add explicit “Apply OCR” action with selective merge that never touches manual-only fields (phones, email).
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
