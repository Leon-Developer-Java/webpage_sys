# Preview race and task selection acceptance — 2026-10-14

## Result-selection defect

Reproduced in an isolated real browser: visit run/task-00, choose history/task-12, visible result header is task-12 but selected history article remains task-00. WrfStudio.activeTaskId previously preferred selectedTaskId retained from run view over resultTaskId. It now derives selection from current workspace view: result uses resultTaskId, run uses selectedTaskId, new configuration selects no old task. Both history and running rows share that selection. No task data, product time or forcing-cycle fields changed.

## Async preview review

Existing WrfTaskConfig.cancelPreview aborts the old request and advances a sequence; response acceptance requires both the current sequence and current geometry signature. The editor also binds preview request IDs; submit blocks pending/error/invalid input and checks the validated request snapshot before emitting. No race defect was reproduced, so these product protections were not rewritten.

New browser regression delays a successful D02 edit response and a failing D03 response, switches selected domains, performs two consecutive undos, waits for the latest canonical preview, then releases old responses in reverse order. It compares rendered paths before/after late replies, restored numeric inputs and complete canonical domain trees, validates submit disabled while pending, and verifies both validation request and actual host submit event carry the restored canonical tree. All real business requests are intercepted; no computation starts.

## Validation and switch

Nine unique focused browser cases passed across regression batches: explicit/latest result reload, unavailable result protection, four-domain redraw/move/resize/undo, direct numeric matrix, history highlight, late-preview race, input-only stale preview and invalid buffers. Initial highlight regression failed expected task-12 / received task-00, then passed after the view-selection fix. Initial race test compared raw request fields rather than normalized domain defaults and read the submit event before its async response; corrected the expected canonical baseline and awaited host submission, preserving all product assertions.

Vue production build passed, with existing annotation/chunk-size warnings. Shared component remains2.2.3; no package change required. Actual5177 transformed WrfStudio.vue returnsHTTP200 with the new view-bound selection expression, loaded through the existing Vite hot-update flow. No backend/service restart, authentication change, real task submission, download or cleanup. Automated monitor remains disabled. Browser tests verify the scenario; no real historical task or result was modified.
