/**
 * Fast keyword-based task classification. Zero cost, instant.
 * Returns null if no confident match — caller falls back to "developer".
 */

import { getCoreAgentProfiles, resolveLegacyAgentType } from "@/lib/config/agent-profiles";

const KEYWORD_RULES: Array<{ patterns: RegExp[]; agentType: string }> = [
  // General — question words without code/business context
  { patterns: [/^(why|what|how|when|where|who|explain|tell me|describe)\b/i, /\?$/], agentType: "general" },

  // Developer — code/build/git language, plus architecture/security/infra
  // language that used to route to the now-cut "cto" profile (its alias
  // target is "developer" — resolveLegacyAgentType below still normalizes
  // this defensively, but writing the surviving id directly here keeps the
  // rule legible rather than routing through the alias silently).
  { patterns: [/\b(fix|bug|debug|refactor|implement|build|deploy|test|lint|migrate|commit|push|pull|merge|branch|npm|pip|cargo|docker|compile|error|exception|stack trace|endpoint|api|route|component|function|class|module|package|dependency)\b/i], agentType: "developer" },
  { patterns: [/\b(architecture|infrastructure|security audit|system design|scalability|performance review|tech stack|database design|microservice|monolith|ci\/cd|devops|monitoring|observability)\b/i], agentType: "developer" },

  // Researcher — investigation/analysis, plus data/metrics language that
  // used to route to the now-cut "analyst" profile (alias target: researcher).
  { patterns: [/\b(research|investigate|analyze|compare|competitive analysis|market research|deep dive|find out|gather data|synthesis|literature review|benchmark|survey)\b/i], agentType: "researcher" },
  { patterns: [/\b(data analysis|metrics|dashboard|sql|query|dataset|visualization|chart|graph|statistics|trend|kpi|conversion rate|funnel|cohort|a\/b test)\b/i], agentType: "researcher" },

  // Marketing — content/campaigns
  { patterns: [/\b(blog post|social media|tweet|linkedin|instagram|ad copy|newsletter|email campaign|content calendar|brand|seo|hashtag|caption|landing page copy|cta|call to action|marketing)\b/i], agentType: "marketing" },

  // Founder — strategy/business, plus vision/priorities ("ceo"), financial
  // ("cfo"), and capability-gap ("inventor") language — all three cut
  // profiles alias to founder; written directly for legibility, same as above.
  { patterns: [/\b(business model|market size|tam|sam|som|competitive moat|fundraising|pitch deck|investor|startup|mvp|product-market fit|go-to-market|gtm|pricing strategy|unit economics|swot)\b/i], agentType: "founder" },
  { patterns: [/\b(prioritize|roadmap|strategic direction|vision|quarterly plan|okr|company goals|leadership|initiative|long-term)\b/i], agentType: "founder" },
  { patterns: [/\b(budget|cost analysis|roi|revenue|profit|financial|forecast|cash flow|burn rate|expense|pricing|invoice|financial report|p&l|balance sheet)\b/i], agentType: "founder" },
  { patterns: [/\b(capability gap|new capability|new skill|new mcp|new lane|new provider|shared contract|shared capability|tool surface|voice capability|live voice)\b/i], agentType: "founder" },

  // QA — verification/ship readiness
  { patterns: [/\b(qa|quality assurance|verify|verification|ship.?ready|pre.?release|pre.?ship|acceptance test|regression test|smoke test|spec compliance|ready to ship|ready to merge|ready to release|sign.?off|final pass|test plan|test coverage|bug bash|edge case|pen.?test|vulnerability scan|security review|audit)\b/i], agentType: "qa" },

  // Designer — UX/UI, design systems, prototypes
  { patterns: [/\b(ux|ui|user experience|user interface|wireframe|mockup|mock.?up|prototype|design system|design token|figma|sketch|adobe xd|interaction design|visual design|information architecture|ia|user journey|user flow|usability|accessibility|a11y|wcag|affordance|heuristic|design critique|design review|style guide|brand guidelines|color palette|typography|iconography|empty state|loading state|micro.?interaction|hover state|focus state|component library|atomic design|design handoff|responsive design|mobile.?first)\b/i], agentType: "designer" },

  // NOTE: no rule maps to "trader" — it's domain-tier, gated out of
  // auto-routing entirely (see agent-profiles.ts §5c of the activation spec).
  // A prompt with stocks/trading language falls through to "developer"
  // rather than being auto-picked; the operator can still pick it explicitly
  // on the New Task role select.
  //
  // "coo" is core-tier (promoted in Spec 3 Phase 4) and IS reachable via the
  // LLM classifier — it simply has no fast keyword rule here, since
  // delegation/coordination language ("coordinate the launch") is too easily
  // confused with ordinary project-management prose for a cheap regex to
  // gate reliably. It falls through to the keyword layer's "developer"
  // default only when the LLM classifier is unavailable.
];

export function classifyByKeywords(description: string): string | null {
  // Defensive: even if a future rule is added pointing at a removed or
  // gated id, never return anything the classifier isn't allowed to choose
  // — resolve any legacy alias, then require the result to still be a
  // tier==="core" profile (never coordinator/domain).
  const coreIds = new Set(getCoreAgentProfiles().map((p) => p.id));
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(description))) {
      const resolved = resolveLegacyAgentType(rule.agentType);
      return coreIds.has(resolved) ? resolved : null;
    }
  }
  return null;
}
