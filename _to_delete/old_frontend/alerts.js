// Rule-based alert algorithm. Reads src/config/alert_rules.json and returns, for one site,
// the level that fired plus a plain-language trace of the conditions that made it fire.
import rules from "../config/alert_rules.json";

const OPS = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};

const NAMES = { navic_error_m: "NavIC error", disaster_active: "disaster zone active" };

// Returns { ok, text } where text describes the condition as evaluated.
function evaluate(cond, ctx) {
  if (cond.always) return { ok: true, text: "no higher level matched" };
  if (cond.all) {
    const parts = cond.all.map((c) => evaluate(c, ctx));
    return { ok: parts.every((p) => p.ok), text: parts.map((p) => p.text).join(" and ") };
  }
  if (cond.any) {
    const parts = cond.any.map((c) => evaluate(c, ctx));
    const hit = parts.find((p) => p.ok);
    return { ok: Boolean(hit), text: hit ? hit.text : parts.map((p) => p.text).join(" or ") };
  }
  if (cond.flag) {
    const v = Boolean(ctx[cond.flag]);
    const ok = v === cond.equals;
    return { ok, text: ok ? NAMES[cond.flag] ?? cond.flag : `not ${NAMES[cond.flag] ?? cond.flag}` };
  }
  if (cond.metric) {
    const v = ctx[cond.metric];
    const ok = OPS[cond.op](v, cond.value);
    return { ok, text: `${NAMES[cond.metric] ?? cond.metric} ${v.toFixed(1)} m ${cond.op} ${cond.value} m` };
  }
  throw new Error(`Unknown rule condition: ${JSON.stringify(cond)}`);
}

export function classifyAlert({ navic_error_m, disaster_active }) {
  const ctx = { navic_error_m, disaster_active };
  for (const level of rules.levels) {
    const r = evaluate(level.when, ctx);
    if (r.ok) return { id: level.id, label: level.label, status: level.status, action: level.action, rule: r.text };
  }
  return null;
}

export const ALERT_LEVELS = rules.levels.map((l) => ({ id: l.id, label: l.label, status: l.status }));
