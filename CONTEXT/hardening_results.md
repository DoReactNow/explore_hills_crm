# Phase 11 Results

What was measured on 2026-11-01, and what that does and doesn't prove. Repeat with the commands in `local_setup.md`.

**Where it ran:** one Mac, with the app, worker, Docker database and load generator all sharing it. A real server will differ, so repeat on the server before go-live. Fake providers throughout, so no time spent waiting on WhatsApp or calling providers is included.

## Load test (`P11-OBS-04`, `-05`)

Data: 30 people, 100,000 leads, 1,000,000 messages, 50,000 follow-ups, 50,000 calls, 100,000 notifications, 100,000 audit records. Each person had a live-update stream open.

**Normal pace (about 14 requests a second, 90 seconds).** Times in milliseconds.

| Action | Requests | Errors | Median | 95% | Slowest | Limit for 95% |
|:---|:---|:---|:---|:---|:---|:---|
| report 1 year | 5 | 0 | 729 | 2098 | 2098 | 3000 |
| report 30 days | 15 | 0 | 221 | 1862 | 1862 | 3000 |
| GET dashboard | 73 | 0 | 30 | 963 | 1657 | 1000 |
| GET conversation | 117 | 0 | 13 | 540 | 1891 | 1000 |
| GET conversations | 118 | 0 | 28 | 489 | 1712 | 1000 |
| GET calls | 57 | 0 | 34 | 476 | 1023 | 1000 |
| GET follow-ups | 77 | 0 | 19 | 181 | 798 | 1000 |
| GET leads list | 189 | 0 | 26 | 143 | 1534 | 1000 |
| GET lead | 210 | 0 | 15 | 135 | 1700 | 1000 |
| GET notifications | 99 | 0 | 9 | 128 | 1339 | 1000 |
| GET me | 104 | 0 | 10 | 118 | 1688 | 1000 |
| GET leads search | 59 | 0 | 42 | 114 | 1727 | 1000 |
| POST note | 57 | 0 | 20 | 104 | 533 | 1000 |
| page /leads | 111 | 0 | 9 | 83 | 1856 | 1000 |
| GET queue | 9 | 0 | 20 | 43 | 43 | 1000 |
| GET audit | 2 | 0 | 42 | 42 | 42 | 1000 |

**Three times the pace (about 38 requests a second, 90 seconds), including heavy Admin screens and exports.**

| Action | Requests | Errors | Median | 95% | Slowest | Limit for 95% |
|:---|:---|:---|:---|:---|:---|:---|
| export leads 1 year | 4 | 0 | 3365 | 3794 | 3794 | 60000 |
| report 1 year | 11 | 0 | 721 | 2089 | 2089 | 3000 |
| GET queue | 26 | 0 | 16 | 717 | 2001 | 1000 |
| report 30 days | 27 | 0 | 182 | 628 | 1496 | 3000 |
| GET audit | 5 | 0 | 26 | 594 | 594 | 1000 |
| GET follow-ups | 171 | 0 | 16 | 560 | 2011 | 1000 |
| GET dashboard | 174 | 0 | 25 | 545 | 1788 | 1000 |
| GET calls | 178 | 0 | 27 | 523 | 2071 | 1000 |
| GET leads search | 138 | 0 | 37 | 515 | 2043 | 1000 |
| POST note | 193 | 0 | 14 | 481 | 2022 | 1000 |
| GET conversations | 367 | 0 | 21 | 463 | 2029 | 1000 |
| GET leads list | 455 | 0 | 20 | 421 | 2072 | 1000 |
| GET me | 283 | 0 | 8 | 420 | 1837 | 1000 |
| GET notifications | 255 | 0 | 7 | 405 | 1860 | 1000 |
| GET lead | 416 | 0 | 11 | 380 | 1869 | 1000 |
| GET conversation | 349 | 0 | 10 | 320 | 1968 | 1000 |
| page /leads | 342 | 0 | 7 | 313 | 1671 | 1000 |
| GET audit search | 5 | 0 | 47 | 51 | 51 | 1000 |
| GET privacy search | 2 | 0 | 25 | 25 | 25 | 1000 |

Some small samples, such as the audit screen and the 1-year report, are only a few requests, so their 95% figure is close to a single reading.

- **Worth knowing:** a 1-year report takes about 0.7 to 2 seconds, and while it runs other requests on that instance can pause, which is why the slowest figures reach about 2 seconds. Most requests stay inside the limit, including at triple pace. At normal pace the dashboard's 95% was 963 ms, close to its limit, in a run with these reports. Moving reports off the main process is the first thing to do if this ever matters.
- **Indexes:** no query took over 100 ms in the triple-pace run, so none were added.
- **Live updates:** 300 streams open at once, 5 notices each: 1,500 of 1,500 delivered, 95% within about 50 ms, none dropped.
- **Connections:** peak 24 of 100. App memory after the triple-pace run: 232 MB.

## Backup and restore (`P11-OBS-02`)

The load database plus 500 invented recordings of 256 KB: backup 5.9 s, restore 7.4 s. All 55 tables matched by row count, all 500 recordings matched their stored checksum, and append-only triggers came back. A restore over existing data and a damaged backup were both refused. Sizes are small compared with months of real recordings, so the real timing comes from the Phase 12 server.

## Monitoring, security and accessibility

See the tests named in `test_scenarios.md`. What they don't cover:

- **Penetration test:** automated by the project itself, not independent (Decision 67).
- **Accessibility:** automated checks of WCAG A and AA rules on 18 signed-in screens on a desk and a phone, plus sign-in and the notice. A person using a screen reader hasn't tried it.
- **Disk alert:** proven with an invented disk reading, not a really full disk.
- **Images:** scanned for env files and known placeholder values. The worker image went from about 1.45 GB to 991 MB; the app image is 565 MB.

## Drills (`P11-OBS-03`, `-06`)

Two app instances and two workers on the load database, run with `scripts/drills/run-resilience.sh`. All checks passed: events crossed instances both ways, the export limit held across both, each every-minute job was created once a minute and no job ran on two workers, killed workers came back, both apps and the worker recovered from a database restart unaided, a stopped worker raised one real alert from the running app and it cleared, and connections peaked at 27 to 30 of 100. The first run found a real crash (`P11-OBS-08`), now fixed.

These ran as plain processes on the Mac. The production images were started once with Compose on a throwaway database: healthy, jobs running, no worker errors, in development mode because production refuses fake providers.

## Deliberate rule breaks

33 breaks of the Phase 11 rules. 29 were caught at once. Three exposed test gaps, now closed and caught. One changes nothing (`ON CONFLICT DO NOTHING` has only that one index to hit).
