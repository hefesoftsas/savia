# Pages search: FlexSearch IndexedDB probe

Throwaway feasibility experiment, not a production Pages integration. It reads
no production pages and does not change the existing Orama experiment.

## Result

**FlexSearch 0.8.212 can persist a textual index in IndexedDB, search it after
reloading without rebuilding, and persist individual updates and deletions.**
Verified in the local in-app browser, Chromium 154 on macOS. Vite 6.4.3 and
Orama 3.1.18 are pinned in this isolated npm project.

There is a published-adapter compatibility issue: it accesses
`window.indexedDB`, so a direct import in a Worker fails with
`TypeError: Bb.open is not a function`. The harness supplies `self.window = self`
before dynamically importing FlexSearch. This is a temporary compatibility shim,
not a production integration recommendation. Review a supported worker adapter
or an isolated adapter patch before adopting it. No DOM APIs are supplied.

## Checks performed

- Index 1,000 synthetic fragments, committing every 100 with visible progress.
- Both FlexSearch and Orama find the known fragment 42 for `vacaciones`.
- FlexSearch finds `Política` when querying `politica` without an accent.
- Reload the page and start a fresh Worker: `vacaciones` still returns 42,
  without executing any add/import/rebuild operation.
- Update fragment 42: old `vacaciones` terms disappear, and the new
  `exclusivoactualizado` term returns 42.
- Reload again: only the new term returns 42.
- Delete fragment 42, reload, and verify both terms return no results.
- Repeat initial indexing to obtain a second timing sample.

## Measurements

Two runs of the same synthetic fixture. FlexSearch uses `tokenize: forward`,
disabled query caching, and explicit commits. Orama uses a Spanish textual
index in memory. These engines have different tokenization/ranking behavior.
This compares a persistent text index with an in-memory text index, not vector
search. Neither loads an embedding model.

| Operation                               | FlexSearch / IndexedDB | Orama / memory                    |
| --------------------------------------- | ---------------------- | --------------------------------- |
| Index 1,000 fragments                   | 423.6–696.6 ms         | 62.9–81.1 ms                      |
| First `vacaciones` query after indexing | 0.3–1 ms               | 1.3 ms                            |
| Median of next five queries             | 0.1–0.3 ms             | At or below 0.1 ms timer rounding |

A single-fragment update took 33.3 ms; deletion took 448.2 ms in one run.
The adapter scans posting stores to remove a document's entries, so deletion
and replacement need larger-corpus testing; do not assume constant-time updates.

Fresh Worker mounting varied from 3.3 to 86.9 ms across the observed actions.
The first successful reload search took 3.2 ms. The old-term miss after another
reload took 35.4 ms; results are noisy and these samples are not a latency SLA.

The built FlexSearch library chunk is 50,541 bytes, or 17,222 bytes with local
gzip compression. The benchmark worker also bundles Orama; that worker's size
does not represent a FlexSearch-only product bundle.

## Recommendation and limits

FlexSearch is a viable candidate for a persistent browser text-search cache for
Pages. It avoids embedding-model inference and supports reuse across reloads.
It does **not** provide semantic vector retrieval. The timing probe does not
measure RAM; the follow-up [memory measurements](memory-results.md) estimate
application memory and attribute JavaScript bytes to the dedicated Worker.

The fixture mostly repeats a common document body and is intentionally small.
Real Pages, richer Spanish queries, ranking quality, broader queries, browser
compatibility, storage eviction, and larger-corpus updates remain untested.

A production cache would need user/workspace isolation, document version
tracking, authorization revalidation, logout cleanup, and a rebuild path. The
backend remains the canonical source of pages and permissions. This harness
only stores index postings and numeric IDs, without page-body persistence.

## Reproduce

```sh
cd docs/experiments/pages-search-flexsearch
npm ci
npm run dev
```

Open `http://127.0.0.1:5184`; stop the SurrealDB probe first if it uses that port.
Click **Index 1,000 fragments**, reload, then **Reopen without indexing**.
Next **Update fragment 42**, reload/reopen, and **Remove fragment 42**,
reload/reopen. Every action starts a fresh Worker. The log reports timings,
result IDs, and assertion failures. Only the synthetic database
`flexsearch:savia-pages-flexsearch-probe-v1` on this origin is affected.

## References

- [IndexedDB adapter](https://github.com/nextapps-de/flexsearch/blob/master/doc/persistent-indexeddb.md)
- [Persistent indexes and commit behavior](https://github.com/nextapps-de/flexsearch/blob/master/doc/persistent.md)
