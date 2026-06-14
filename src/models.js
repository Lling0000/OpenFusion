export function listModels(config) {
  const virtual = [
    {
      id: "openfusion/auto",
      kind: "virtual",
      description: "Rule-based auto router that selects single or fusion-style roles."
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
