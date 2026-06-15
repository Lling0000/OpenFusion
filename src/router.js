const SKILL_RULES = [
  {
    role: "coder",
    patterns: [
      /\b(code|bug|debug|test|typescript|javascript|python|react|node|api|stack trace|patch|refactor)\b/i,
      /报错|代码|测试|接口|修复|调试|重构/
    ]
  },
  {
    role: "reasoner",
    patterns: [
      /\b(compare|decide|tradeoff|architecture|design|plan|why|prove|math|reason)\b/i,
      /比较|取舍|架构|方案|推理|证明|为什么/
    ]
  },
  {
    role: "verifier",
    patterns: [
      /\b(verify|risk|security|edge case|review|audit|failure|safe|eval)\b/i,
      /验证|风险|安全|边界|审查|评估/
    ]
  },
  {
    role: "writer",
    patterns: [
      /\b(write|rewrite|summarize|email|readme|docs|copy|blog|translate)\b/i,
      /写|改写|总结|文档|邮件|翻译|README/i
    ]
  }
];

export function routeQuestion(question, config) {
  const roles = Object.keys(config.roles);
  const scored = new Map(roles.map((role) => [role, 0]));
  const matchedReasons = [];

  for (const rule of SKILL_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(question)) {
        scored.set(rule.role, (scored.get(rule.role) ?? 0) + 2);
        addReason(matchedReasons, builtInReason(rule.role));
      }
    }
  }

  for (const rule of customRules(config)) {
    if (!config.roles[rule.role]) continue;
    if (!matchesCustomRule(question, rule)) continue;

    const score = Number.isFinite(rule.score) ? rule.score : 3;
    scored.set(rule.role, (scored.get(rule.role) ?? 0) + score);
    addReason(matchedReasons, rule.reason ?? `custom ${rule.role} signal`);
  }

  scored.set("fast", (scored.get("fast") ?? 0) + 1);
  scored.set(config.fusion.judgeRole, (scored.get(config.fusion.judgeRole) ?? 0) + 1);

  const ranked = [...scored.entries()]
    .filter(([role]) => config.roles[role])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const selected = ranked
    .filter(([, score]) => score > 0)
    .slice(0, config.fusion.maxPanel)
    .map(([role]) => role);

  while (selected.length < config.fusion.minPanel) {
    const next = roles.find((role) => !selected.includes(role));
    if (!next) break;
    selected.push(next);
  }

  return {
    selectedRoles: selected,
    scores: Object.fromEntries(ranked),
    rationale: explainRoute(selected, matchedReasons)
  };
}

function customRules(config) {
  return Array.isArray(config.routing?.rules) ? config.routing.rules : [];
}

function matchesCustomRule(question, rule) {
  const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
  const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];

  return keywords.some((keyword) => question.toLowerCase().includes(String(keyword).toLowerCase()))
    || patterns.some((pattern) => safeRegexTest(pattern, question));
}

function safeRegexTest(pattern, question) {
  try {
    return new RegExp(pattern, "i").test(question);
  } catch {
    return false;
  }
}

function builtInReason(role) {
  return {
    coder: "coding/debugging signals",
    reasoner: "architecture or tradeoff signals",
    verifier: "verification and risk signals",
    writer: "writing or documentation signals"
  }[role] ?? `${role} signals`;
}

function addReason(reasons, reason) {
  if (reason && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function explainRoute(selectedRoles, reasons) {
  return reasons.length
    ? `Selected ${selectedRoles.join(", ")} because the prompt contains ${reasons.join(", ")}.`
    : `Selected ${selectedRoles.join(", ")} as a balanced default panel.`;
}
