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

  for (const rule of SKILL_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(question)) {
        scored.set(rule.role, (scored.get(rule.role) ?? 0) + 2);
      }
    }
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
    rationale: explainRoute(question, selected)
  };
}

function explainRoute(question, selectedRoles) {
  const reasons = [];
  if (/code|bug|debug|test|代码|测试|修复|调试/i.test(question)) {
    reasons.push("coding/debugging signals");
  }
  if (/compare|tradeoff|architecture|方案|架构|比较|取舍/i.test(question)) {
    reasons.push("architecture or tradeoff signals");
  }
  if (/verify|risk|security|review|风险|安全|审查|验证/i.test(question)) {
    reasons.push("verification and risk signals");
  }
  if (/write|summarize|readme|docs|文档|总结|改写/i.test(question)) {
    reasons.push("writing or documentation signals");
  }

  return reasons.length
    ? `Selected ${selectedRoles.join(", ")} because the prompt contains ${reasons.join(", ")}.`
    : `Selected ${selectedRoles.join(", ")} as a balanced default panel.`;
}
