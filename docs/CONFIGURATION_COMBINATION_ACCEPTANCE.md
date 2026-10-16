# WRF configuration validation — 2026-10-15

The host uses the existing compute-free `/api/wrf/namelist/resolve` endpoint after a 350 ms debounce. Errors block submit; pending input conditions remain explicit; neither preview nor validation changes editor values. Aborted/out-of-order responses are bound to a sequence and complete request signature. Final submission still checks its captured snapshot. Schema 422 errors are configuration conflicts; unavailable connections can be retried. No additional confirmation dialog.

Seven dedicated browser cases and all 48 existing browser cases passed. Final build passed. Actual desktop/mobile error-panel and submit visibility were checked, with a screenshot inspected. Existing interaction fixtures mock parameter preview independently; the dedicated suite uses the actual backend resolver. Runtime 5177 module was checked after hot update, shared component version stays 2.2.4.

Backend rule coverage, original Fortran matrix, real API acceptance, safe API-only maintenance and task/log preservation are recorded in `../../backend_wrf/docs/CONFIGURATION_COMBINATION_ACCEPTANCE.md`. Evidence is under `.run/wrf-refactor/config-validation-20261015/` at the project root. No real computation or task parameter change was performed.
