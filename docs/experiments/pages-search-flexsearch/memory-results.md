# Pages text-search memory measurements

Measured in Chromium 154 on macOS with FlexSearch 0.8.212 and Orama 3.1.18.
This is the isolated synthetic probe, not the Savia admin application's memory.
Raw API responses are in [memory-results.json](memory-results.json).

## Results

Memory retained after indexing and garbage collection, with the index still
reachable and usable. MiB means 1,048,576 bytes.

| Scenario                                  | Worker JavaScript | Additional Worker JS above loaded engine | Whole application estimate |
| ----------------------------------------- | ----------------- | ---------------------------------------- | -------------------------- |
| FlexSearch / IndexedDB, 1,000 fragments   | 0.67 MiB          | 0.24 MiB                                 | 2.96 MiB                   |
| Orama / memory, 1,000 fragments           | 5.82 MiB          | 5.05 MiB                                 | 8.11 MiB                   |
| FlexSearch / IndexedDB, 10,000 fragments  | 0.69 MiB          | 0.26 MiB                                 | 2.77 MiB                   |
| Orama / memory, 10,000 fragments          | 24.19 MiB         | 23.43 MiB                                | 26.32 MiB                  |
| Reopen FlexSearch 10,000 without indexing | 0.46 MiB          | 0.03 MiB                                 | 2.61 MiB                   |

After one search, Worker JS was respectively 0.66, 5.80, 0.68, 24.18, and
0.48 MiB. Every search returned the expected fragment 42. The index stays in a
module-level Worker variable across measurements, so collection cannot discard
it merely because the build function returned.

The loaded-engine Worker baselines were approximately 0.43 MiB for FlexSearch
and 0.76 MiB for Orama. The source fixtures contain 1.18 MiB and 12.00 MiB of
UTF-8 text respectively; source byte size is not a predicted heap size.

**For this fixture, persistent FlexSearch uses substantially less retained
Worker JavaScript memory.** Reopening the 10,000-fragment index does not load a
comparable full in-memory index. Orama stores document bodies as well as its
textual index; the FlexSearch Index probe stores postings and IDs, without a
document-body store. That difference is intentional but matters when designing
result snippets for production.

## Method

The follow-up harness is `memory.html`, `memory.js`, and `memory.worker.js`.
It uses `performance.measureUserAgentSpecificMemory()` with COOP/COEP isolation
headers enabled only in this local experiment's Vite configuration. It records
four stages per scenario: page alone, loaded engine and Worker, retained index,
and after search. A new dedicated Worker replaces the previous Worker between
scenarios, and only the selected search library is loaded in it.

The application total is the API's `bytes` field. Worker bytes are the sum of
breakdown entries attributed to `DedicatedWorkerGlobalScope`; the observed
entries are JavaScript. The browser also reports DOM, Window JavaScript, and
unattributed shared memory. Shared-memory variation explains why the whole-page
totals are less stable than Worker JavaScript accounting.

The FlexSearch fixture is committed in batches of 100, with query caching
disabled. The reopen action mounts the same IndexedDB database without adding,
clearing, importing, or rebuilding records. Both libraries receive the same
synthetic text used in the original timing probe; the 10,000 case extends the
same generator.

## Limits

- One completed sample per stage/scenario, after collection. No transient
  indexing peak was measured, and these are not statistical confidence bounds.
- These are application-memory estimates and attributed JavaScript bytes, not
  operating-system process RSS. Browser/native IndexedDB caches may not be fully
  accounted for; moving storage out of the heap does not make all storage-related
  RAM consumption disappear.
- No embedding model or vectors are included. These results compare textual
  search, not the existing semantic experiment with TensorFlow.
- The bodies are synthetic and highly repetitive. Real page vocabulary, query
  breadth, snippets, cache settings, document stores, and browser versions can
  change the result. Do not infer a universal percentage reduction.
- Browser support for this memory API is limited. Results are comparable within
  this browser setup, not across different engines or versions.

## Reproduce

```sh
cd docs/experiments/pages-search-flexsearch
npm ci
npm run dev
```

Open `http://127.0.0.1:5184/memory.html`. Run the two 1,000-fragment scenarios,
then the two 10,000-fragment scenarios, then **Reopen FlexSearch 10,000**.
Wait for `complete` after each action; memory collection can take tens of
seconds per stage. Synthetic indexes use the isolated databases
`flexsearch:savia-pages-flex-memory-1000` and
`flexsearch:savia-pages-flex-memory-10000`.

References: [memory API](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory),
[Chromium measurement behavior](https://web.dev/articles/monitor-total-page-memory-usage).
