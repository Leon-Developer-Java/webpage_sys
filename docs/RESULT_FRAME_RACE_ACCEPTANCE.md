# Result-frame race acceptance — 2026-10-14

## Changes

WrfResultLayer now identifies image work by task/domain/variable/frame metadata/extent rather than URL alone. Each load captures its frame; generation and abort checks protect both fetch and decode. On selection changes the image, committed time/range and legend are cleared; a pending event updates available times without retaining the old element/time as if loaded. Only a committed frame populates legend ticks and toolbar time. Parent handlers reject events from other task IDs. Explicit conflicting metadata task IDs are rejected; older responses with no task_id remain compatible with the explicitly requested task endpoint. Metadata generation is invalidated on unmount.

The URL records committed domain, variable and frame index. Reload selects valid domain/variable from real metadata and clamps the restored index only after available times arrive; invalid/obsolete choices fall back to actual metadata defaults/range. Query-only updates do not reload the task. A separate restore index avoids the slider's max=0 initial clamp, observed in the first new regression. Navigation to a different task clears result state through the existing generation-bound resolver.

Rapid task switches also reproduced a ProjectionMap late vector fetch calling rebuildLines after WebGL context disposal (null bindBuffer). Vector completion/rebuild now checks context liveness; unmount invalidates mosaic/data-texture tokens. Shared component2.2.4 contains this minimal lifecycle guard; no scientific projection, palette or task data changes.

## Verification

Seven focused browser cases pass: uncertain-create result controls for transport/http503, explicit/latest result reload, task-selection highlight, and two full result race cases (distinct/shared image URL). Race cases delay old task metadata, delay two wind frames, switch to current temperature frame, release responses in reverse order, verify loading removes old legend/image, then check task ID, selected variable, committed time, palette and decoded WebP pixel content. They finally select non-default wind variable/second time, reload and verify selected task/variable/time and ready map. Shared-URL case proves differing frame metadata/time is not skipped. All business APIs are intercepted; no real calculation or asset mutation.

First new regression exposed failed second-frame restoration and null-context pageerror; both corrected and rerun passed. The available-times empty-pending guard alone did not fix restore; final separate deferred index did. Existing29 component tests pass; Vue and React production builds pass with existing annotation/chunk/externalized-module and pinned jsdom engine warnings.

## Runtime switch

Both consumers install identical2.2.4 tarball. Source SHA533ea26000475079cdde857ff4b6e084a3a0e727421b5d4ec731b8dc98fc770d; bundle SHA83c61d4f122cac5ea8a2b0301b9556d77d3d00fbcafc6b4d4846061470702372. Old archives retained. Runtime5177/5173 initially returned stale cached bundles; normal Vite config-watch reloads (content unchanged) refreshed their modules. Both subsequently returnedHTTP200 with new source fingerprint; actual5177 WrfResultLayer supplies identity guard. No backend restart, direct user-page refresh, database mutation, new task, download or deletion. Existing automation remains disabled.
