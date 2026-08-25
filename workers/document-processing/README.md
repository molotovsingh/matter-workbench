# Document Processing Workers

Stateless V4 worker boundary. Workers claim fenced page leases from the service control plane, resolve a pinned capability adapter, checkpoint provider attempts and cost evidence, validate page output, and trigger complete versioned assembly when eligible.

Both reference and PostgreSQL workers are executable in isolation. `worker-scratch-space.mjs` provides streamed, size-bounded, free-space-reserving, digest-verified temporary materialization with success/failure/stale cleanup. The single-page worker supports selective capabilities such as repair. The document-range worker atomically claims consecutive compatible pages, makes one pinned Mistral OCR 4.1 call, allocates cost/usage per attempt, and independently fences every page checkpoint. Production workers must combine these boundaries with encrypted ephemeral volumes, adaptive concurrency, and capacity-aware admission. No worker owns authoritative source or result state locally.
