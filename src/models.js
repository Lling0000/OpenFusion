export function listModels(config) {
  const virtual = [
    {
      id: "openfusion/auto",
      kind: "virtual",
      description: "Transparent auto policy that scores candidates by task fit, benchmarks, price, performance, availability, fallback, and stickiness before choosing single-model, verified, or full-fusion execution."
    },
    {
      id: "openfusion/fusion",
      kind: "virtual",
      description: "Runs a role-based panel, judge, and synthesizer."
    }
  ];

  const roles = Object.entries(config.roles).map(([role, value]) => ({
    id: `openfusion/${role}`,
    kind: "role",
    role,
    upstream_model: value.model,
    description: value.description
  }));

  return [...virtual, ...roles];
}
