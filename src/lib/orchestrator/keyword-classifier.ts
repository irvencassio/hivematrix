/**
 * Fast keyword-based task classification. Zero cost, instant.
 * Returns null if no confident match — caller falls back to "developer".
 */

const KEYWORD_RULES: Array<{ patterns: RegExp[]; agentType: string }> = [
  // General — question words without code/business context
  { patterns: [/^(why|what|how|when|where|who|explain|tell me|describe)\b/i, /\?$/], agentType: "general" },

  // Developer — code/build/git language
  { patterns: [/\b(fix|bug|debug|refactor|implement|build|deploy|test|lint|migrate|commit|push|pull|merge|branch|npm|pip|cargo|docker|compile|error|exception|stack trace|endpoint|api|route|component|function|class|module|package|dependency)\b/i], agentType: "developer" },

  // Researcher — investigation/analysis
  { patterns: [/\b(research|investigate|analyze|compare|competitive analysis|market research|deep dive|find out|gather data|synthesis|literature review|benchmark|survey)\b/i], agentType: "researcher" },

  // Marketing — content/campaigns
  { patterns: [/\b(blog post|social media|tweet|linkedin|instagram|ad copy|newsletter|email campaign|content calendar|brand|seo|hashtag|caption|landing page copy|cta|call to action|marketing)\b/i], agentType: "marketing" },

  // Founder — strategy/business
  { patterns: [/\b(business model|market size|tam|sam|som|competitive moat|fundraising|pitch deck|investor|startup|mvp|product-market fit|go-to-market|gtm|pricing strategy|unit economics|swot)\b/i], agentType: "founder" },

  // CEO — vision/priorities
  { patterns: [/\b(prioritize|roadmap|strategic direction|vision|quarterly plan|okr|company goals|leadership|initiative|long-term)\b/i], agentType: "ceo" },

  // CTO — architecture/security
  { patterns: [/\b(architecture|infrastructure|security audit|system design|scalability|performance review|tech stack|database design|microservice|monolith|ci\/cd|devops|monitoring|observability)\b/i], agentType: "cto" },

  // Inventor — new capabilities, new Bees, shared surfaces
  { patterns: [/\b(inventorbee|capability gap|new capability|new skill|new mcp|new bee|shared contract|shared capability|tool surface|voice capability|live voice)\b/i], agentType: "inventor" },

  // QA — verification/ship readiness
  { patterns: [/\b(qa|quality assurance|verify|verification|ship.?ready|pre.?release|pre.?ship|acceptance test|regression test|smoke test|spec compliance|ready to ship|ready to merge|ready to release|sign.?off|final pass|test plan|test coverage|bug bash|edge case|pen.?test|vulnerability scan|security review|audit)\b/i], agentType: "qa" },

  // Designer — UX/UI, design systems, prototypes
  { patterns: [/\b(ux|ui|user experience|user interface|wireframe|mockup|mock.?up|prototype|design system|design token|figma|sketch|adobe xd|interaction design|visual design|information architecture|ia|user journey|user flow|usability|accessibility|a11y|wcag|affordance|heuristic|design critique|design review|style guide|brand guidelines|color palette|typography|iconography|empty state|loading state|micro.?interaction|hover state|focus state|component library|atomic design|design handoff|responsive design|mobile.?first)\b/i], agentType: "designer" },

  // CFO — financial
  { patterns: [/\b(budget|cost analysis|roi|revenue|profit|financial|forecast|cash flow|burn rate|expense|pricing|invoice|financial report|p&l|balance sheet)\b/i], agentType: "cfo" },

  // COO — operations/delegation
  { patterns: [/\b(coordinate|delegate|workflow|process optimization|project plan|resource allocation|operations|handoff|status update|sprint plan|kanban|assign)\b/i], agentType: "coo" },

  // Analyst — data/metrics
  { patterns: [/\b(data analysis|metrics|dashboard|sql|query|dataset|visualization|chart|graph|statistics|trend|kpi|conversion rate|funnel|cohort|a\/b test)\b/i], agentType: "analyst" },

  // Trader — stocks/ETFs/funds/market analysis
  { patterns: [/\b(stock|stocks|ticker|etf|mutual fund|buy signal|sell signal|portfolio|trading|trade|equities|equity|dividend|earnings|market trend|bull|bear|options|put|call|hedge|risk analysis|technical analysis|moving average|rsi|macd|p\/e ratio|price target|stop.?loss|market cap|sector rotation|vix|s&p|nasdaq|dow jones|russell|forex|commodity|bond yield|treasury|fed rate|ipo|short squeeze|sentiment)\b/i], agentType: "trader" },
];

export function classifyByKeywords(description: string): string | null {
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(description))) return rule.agentType;
  }
  return null;
}
