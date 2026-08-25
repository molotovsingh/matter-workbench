# Document Processing Workers

Stateless V4 worker boundary. Workers claim fenced page leases from the service control plane, resolve a pinned capability adapter, checkpoint provider attempts and cost evidence, validate page output, and trigger complete versioned assembly when eligible.

The current worker runs against isolated filesystem reference adapters for executable design evidence. `worker-scratch-space.mjs` provides streamed, size-bounded, free-space-reserving, digest-verified temporary materialization with success/failure/stale cleanup. Production workers must combine it with encrypted ephemeral volumes, PostgreSQL lease/ownership fencing, object-storage references, adaptive concurrency, and capacity-aware admission. No worker may own authoritative source or result state locally.
