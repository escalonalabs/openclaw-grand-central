# Synthetic Load Benchmark

## Objective

Provide a reproducible synthetic-load harness to measure:

- queue pressure (`droppedEvents`, `queueDepth`)
- throughput (`bridge_events_total`)
- latency budgets (`bridge_event_e2e_latency_ms.total.p95`, `by_qos.critical.p99`)
- multi-lane fairness evidence (`bridge_events_lane_total`)

## Commands

Run benchmark (versioned artifact + latest copy):

```bash
npm run benchmark:synthetic-load
```

Validate budgets against a snapshot:

```bash
npm run verify:synthetic-load-budgets -- artifacts/benchmark/synthetic-load-latest.json
```

Run full benchmark + budgets in one command:

```bash
npm run verify:synthetic-load
```

## Default profile

- `BENCH_EVENT_COUNT=192`
- `BENCH_QUEUE_CAPACITY=64`
- `BENCH_DROP_POLICY=drop-oldest`
- `BENCH_LATENCY_BASE_MS=220`
- `BENCH_LATENCY_JITTER_MS=60`
- lane mix in profile:
  - `lane-critical-a`, `lane-critical-b`
  - `lane-stateful-a`, `lane-stateful-b`
  - `lane-best-a`, `lane-best-b`

## Default budget gates

- `bridge_events_total >= 32`
- `droppedEvents >= 1` (confirms pressure scenario was exercised)
- `droppedEvents <= 160`
- `queueDepth <= 1`
- `bridge_event_e2e_latency_ms.total.p95 <= 400`
- `bridge_event_e2e_latency_ms.by_qos.critical.p99 <= 500`
- `active_lanes >= 4`
- `critical_lane_events >= 1`
- `best_effort_lane_events >= 1`

## Artifacts

Versioned:

- `artifacts/benchmark/synthetic-load-<run-id>.json`
- `artifacts/benchmark/synthetic-load-<run-id>.md`
- `artifacts/benchmark/synthetic-load-budget-report-<run-id>.md`

Latest pointers:

- `artifacts/benchmark/synthetic-load-latest.json`
- `artifacts/benchmark/synthetic-load-latest.md`
- `artifacts/benchmark/synthetic-load-budget-report-latest.md`
