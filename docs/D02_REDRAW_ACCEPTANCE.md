# D02 redraw acceptance — 2026-10-14

## Root cause and change

Browser reproduction selected D02, then began a draw gesture within the D01 path. ProjectedDomainOverlay.begin emitted active-change for the hit D01 before the gesture completed. ProjectedDomainMap.finish used this new selection and submitted domain_id=d01. The reproduction failed exactly with expected d02 / received d01; the authoritative backend then correctly rejected out-of-parent children for that wrongly targeted edit.

Draw mode now does not select the hit domain. The pointer gesture captures activeKey at pointerdown; its draw request uses that original key. Pan/edit selection behavior stays unchanged. Backend geometry code is unchanged, including projected parent-grid alignment, ratio checks and authoritative boundary validation.

## Verification and release

New actual-pointer browser case creates a root and two siblings, selects D02, starts the redraw inside D01, and verifies the outgoing target d02. It compares center, complete parent/sibling domain dictionaries and their geographic boundaries before/after, verifies D02 changes and its aligned dimension. Backend tests additionally compare all ancestor domain dictionaries and boundaries for each nested draw.

37 browser cases: first full run33 pass/4 fail. Three old fixtures lacked the existing read-only forcing/refresh GET response; mocks now return idle or old-service404 only for GET and still reject unexpected writes. The fourth expected obsolete generic deletion text; its assertion now checks the current detailed sanitized error. Four failed cases passed on targeted reruns (one fixture required correcting the intended handler location). No product behavior was weakened for these test failures. 29 shared-component tests and37 backend geometry/configuration tests passed. Vue and React production builds passed, with existing chunk-size/externalized-module warnings. npm reported the existing jsdom engine warning on the pinned toolchain.

Shared package2.2.3, source fingerprint fa5049493c055b83fa109686481a49ed417ed496f7de92b0b167b7c09a47935b, bundle1248f5f07a394ebede6bf275b769595145ad59824b64ffca5ae7e76633e6eeee. Both consumer installed hashes match. Existing2.2.2 archive retained; no different release published under that version. A first edit command used a duplicated cwd prefix and wrote no source; corrected before rebuilding the new version. Local npm cache permission failure was resolved using workspace artifact cache, without chmod/chown.

Runtime5177 initially returned cached2.2.2 despite the new installed artifact. Touching the unchanged existing Vite config triggered its normal in-process restart. Both5177 and5173 subsequently returned2.2.3 with the new source fingerprint. No manual user-page refresh, backend restart, real task submission, download or cleanup. Final read-only maintenance preflight reported current ordinary activity and refused maintenance; no execute operation attempted. Running calculations remain protected.

## Four-domain follow-up

Read-only product review and test-only changes: no new production defect found. New backend matrix exercises all4 domains with movement and all8 resize handles (36 successful edits), checks input immutability, unrelated node dictionaries and complete boundaries, common center preservation for nested edits and nesting alignment. Out-of-parent moves/draws and crossed-corner resizing are rejected. 39 backend geometry/configuration tests pass.

New browser fixture permits a test-only initial request, creates D01 with siblingD02/D03 and non-adjacent grandchildD04. Actual-pointer tests cover D03/D04 redraw, all4 moves and selected-corner resizes, undo after every edit with exact domain/center/boundary comparisons, D04 out-of-parent draw rejection and undo recovery. Four focused browser cases pass including original editing, late-preview protection and D02 regression. Initial new movement coordinates missed the actual root/curved D04 polygon; corrected the test hit coordinates, without changing product behavior or assertions. Test stdout includes expected authoritative rejection tracebacks for negative cases, not unhandled browser errors.

Both runtime5177/5173 modules recheckedHTTP200 with the existing2.2.3 source fingerprint. No new package, backend reload, task submission, data refresh or cleanup needed. Parent moves carry descendants by the existing nested-coordinate relation; resize may adjust direct child local start indices to keep child geographic footprints fixed. These are intended descendant effects; ancestors and unrelated siblings remain unchanged. No claim that every descendant parameter stays fixed during parent resize.

## Direct numeric-edit follow-up

No production defect reproduced; only browser regression and documentation added. Existing UI edits D01 spacing directly and nested spacing via3:1/5:1 ratio, keeping parent spacing authoritative. A new actual-browser matrix performs18 valid numeric changes across all4 domains: root spacing, nested ratios, both grid dimensions, and both nested parent starts. Every edit verifies authoritative boundaries change, SVG paths update, unrelated parent/sibling dictionaries and boundaries remain exact, descendants retain dx*ratio=parent.dx, and grid dimensions remain aligned. Every undo compares the complete domain tree, center and all geographic boundaries. Rendered paths are compared after affine viewport normalization: selection controls/undo notice legitimately resize the map and trigger its fit; absolute pixel differences alone do not prove a geographic change.

Invalid D04 dimension62 is rejected by authoritative nesting validation. Out-of-range parent start499 remains an invalid numeric buffer and disables submission; undo clears that buffer without unnecessary preview, while restoring canonical parameters. Both rejection/undo paths pass. New browser case passed16.3sec; existing29 shared-component cases also passed. Initial test failures were an overly exact select-label locator and absolute-pixel assertions across different container sizes; final assertions preserve exact geographic comparisons and normalized rendered paths, without modifying product code or accepting invalid geometry.

No new artifact or runtime change required. Existing2.2.3 maintained; no backend restart, task submission, data mutation or automatic monitoring enabled.
