# Playback, domain switching and frame recovery — 2026-10-14

## Reproduced issue and repair

The former900ms interval advanced the selected time even when the current image was still pending. A clock-controlled browser test held D01/frame1 and observed an unwanted frame2 request before frame1 completion. Playback now advances only when current committed frame time matches the selected time and visualStatus is ready. Pause stops progression while allowing the selected in-flight frame to finish. Single-frame domains stop playback. HTTP/decoding failure marks failed, clears committed display information and stops playback instead of continuously skipping failed frames.

WrfResultLayer provides an explicit retry button. An image retry increments a request identity counter while keeping task/domain/variable/time; a metadata failure retries metadata via the existing loader. Existing abort/generation guards remain. Failures clear image/time/range display and hidden stale legend; retry restores them only after verified decoding. No background deletion, computation or submission is triggered. Legacy image error also clears displayedFrame and reports failure to the parent.

## Validation

Nine focused real-browser cases passed in one final run29.4sec. Two new cases use a controlled clock and actual mouse slider drag. They cover delayed images, pause while loading, no progression while pending, D01–D04, Kelvin/Celsius and Pa/hPa unit presentation, per-domain palette/tick metadata, single-frame disablement, timeline endpoint, HTTP503 failure, failure stopping the timer, same-frame retry, invalid-WebP decode failure and subsequent recovery. Existing result race tests check distinct/shared URLs, stale metadata and images, decoded image pixels, highlight and non-default variable/time refresh. Original initial playback test failed on the unwanted frame2 request. A new timeline test initially used the wrong test-only class time-strip; corrected to actual timebar and reran successfully without weakening assertions.

Vue production build passed, with existing annotation/chunk-size warnings. Only main Vue host/result layer changed; shared package remains2.2.4 and React/shared sources are unchanged, so no new package release or React rebuild required.

## Runtime

Actual5177 WrfResultLayer serves retryCount and WrfStudio serves the ready-frame playback guard via existing hot update; bothHTTP200. An initial check expected a different whitespace format and failed its string assertion; regex check confirmed the actual code, not a stale module. Backend8007 and8012 health both200. No backend restart, manual user-page reload, actual task/data modification or monitor resumption.
