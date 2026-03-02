#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

SNAPSHOT_PATH="${1:-${ROOT_DIR}/artifacts/observability/metrics-snapshot.json}"
REPORT_PATH="${2:-${ROOT_DIR}/artifacts/observability/alert-report.json}"
REQUIRE_FIRING="${REQUIRE_FIRING:-0}"

if [ ! -f "${SNAPSHOT_PATH}" ]; then
  printf '[evaluate:alert-rules] snapshot not found: %s\n' "${SNAPSHOT_PATH}" >&2
  exit 1
fi

mkdir -p "$(dirname "${REPORT_PATH}")"

node --input-type=module -e '
import fs from "node:fs";

const snapshotPath = process.argv[1];
const reportPath = process.argv[2];
const requireFiring = process.argv[3] === "1";

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getPath = (root, path, fallback = 0) => {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object" || !(key in node)) {
      return fallback;
    }
    node = node[key];
  }
  return toNumber(node, fallback);
};

const rules = [
  {
    id: "bridge_critical_latency_p99_slo_breach",
    severity: "critical",
    value: getPath(snapshot, ["bridge_event_e2e_latency_ms", "by_qos", "critical", "p99"]),
    threshold: 250,
    comparator: ">"
  },
  {
    id: "bridge_total_latency_p95_slo_breach",
    severity: "warn",
    value: getPath(snapshot, ["bridge_event_e2e_latency_ms", "total", "p95"]),
    threshold: 100,
    comparator: ">"
  },
  {
    id: "bridge_authn_failures_detected",
    severity: "warn",
    value: getPath(snapshot, ["bridge_authn_failures_total"]),
    threshold: 0,
    comparator: ">"
  },
  {
    id: "bridge_authz_denies_detected",
    severity: "warn",
    value: getPath(snapshot, ["bridge_authz_denies_total"]),
    threshold: 0,
    comparator: ">"
  },
  {
    id: "bridge_redaction_failures_detected",
    severity: "critical",
    value: getPath(snapshot, ["bridge_redaction_failures_total"]),
    threshold: 0,
    comparator: ">"
  },
  {
    id: "bridge_dropped_events_detected",
    severity: "warn",
    value: getPath(snapshot, ["droppedEvents"]),
    threshold: 0,
    comparator: ">"
  },
  {
    id: "bridge_queue_depth_pressure",
    severity: "warn",
    value: getPath(snapshot, ["queueDepth"]),
    threshold: 64,
    comparator: ">"
  }
];

const alerts = rules.map((rule) => {
  const firing = rule.comparator === ">" ? rule.value > rule.threshold : false;
  return {
    ...rule,
    status: firing ? "firing" : "ok"
  };
});

const firingAlerts = alerts.filter((alert) => alert.status === "firing");

const report = {
  generatedAt: new Date().toISOString(),
  snapshotPath,
  firingCount: firingAlerts.length,
  alerts
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (requireFiring && firingAlerts.length === 0) {
  throw new Error("no firing alerts detected (REQUIRE_FIRING=1)");
}
' "${SNAPSHOT_PATH}" "${REPORT_PATH}" "${REQUIRE_FIRING}"

printf '[evaluate:alert-rules] wrote %s\n' "${REPORT_PATH}"
