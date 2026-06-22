export const defaultConfig = {
  upstream: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    appName: "OpenFusion",
    siteURL: "https://github.com/Lling0000/OpenFusion"
  },
  roles: {
    fast: {
      model: "openai/gpt-4.1-mini",
      description: "Fast general-purpose model for first-pass answers."
    },
    reasoner: {
      model: "anthropic/claude-3.7-sonnet",
      description: "Careful reasoning model for planning and tradeoffs."
    },
    coder: {
      model: "deepseek/deepseek-chat-v3-0324",
      description: "Code-focused model for implementation and debugging."
    },
    verifier: {
      model: "google/gemini-2.5-pro",
      description: "Verifier model for edge cases, tests, and risk checks."
    },
    writer: {
      model: "openai/gpt-4.1",
      description: "Polish model for concise final synthesis."
    }
  },
  routing: {
    rules: []
  },
  auto: {
    thresholds: {
      singleVerifyRisk: 0.55,
      fusionComplexity: 0.72,
      fusionRisk: 0.84
    },
    scoring: {
      costQualityTradeoff: 7,
      stickyBonus: 0.2,
      maxFallbackCandidates: 3,
      weights: {
        skill: 0.24,
        benchmark: 0.22,
        availability: 0.17,
        price: 0.14,
        throughput: 0.09,
        latency: 0.08,
        role: 0.06
      },
      preferences: {
        minAvailability: 0.4,
        minBenchmarkPercentile: null,
        maxUsdPer1M: null,
        preferredMinThroughput: null,
        preferredMaxLatency: null
      }
    },
    stickiness: {
      enabled: true,
      implicit: true,
      ttlMs: 300000
    },
    fallbackRoles: ["fast", "writer", "reasoner"],
    upstreamFallbacks: {
      enabled: true,
      maxModels: 2
    },
    candidates: [
      {
        id: "fast-default",
        role: "fast",
        model: "openai/gpt-4.1-mini",
        description: "Low-latency general-purpose candidate for simple tasks.",
        skills: {
          general: 0.82,
          coding: 0.46,
          reasoning: 0.48,
          verification: 0.38,
          writing: 0.58
        },
        benchmarks: {
          general: 62,
          coding: 48,
          reasoning: 50,
          verification: 44,
          writing: 58
        },
        pricing: {
          inputUsdPer1M: 0.4,
          outputUsdPer1M: 1.6
        },
        performance: {
          throughput: { p50: 115, p90: 70 },
          latency: { p50: 0.8, p90: 2.1 }
        },
        availability: 0.86,
        upstream: {
          provider: {
            sort: "latency",
            allow_fallbacks: true
          }
        }
      },
      {
        id: "reasoner-default",
        role: "reasoner",
        model: "anthropic/claude-3.7-sonnet",
        description: "Reasoning candidate for architecture, planning, and tradeoffs.",
        skills: {
          general: 0.66,
          coding: 0.64,
          reasoning: 0.88,
          verification: 0.68,
          writing: 0.7
        },
        benchmarks: {
          general: 82,
          coding: 74,
          reasoning: 88,
          verification: 72,
          writing: 76
        },
        pricing: {
          inputUsdPer1M: 3,
          outputUsdPer1M: 15
        },
        performance: {
          throughput: { p50: 58, p90: 34 },
          latency: { p50: 1.5, p90: 4.5 }
        },
        availability: 0.84,
        upstream: {
          provider: {
            sort: "price",
            allow_fallbacks: true
          }
        }
      },
      {
        id: "coder-default",
        role: "coder",
        model: "deepseek/deepseek-chat-v3-0324",
        description: "Coding candidate for implementation, debugging, and tests.",
        skills: {
          general: 0.6,
          coding: 0.86,
          reasoning: 0.68,
          verification: 0.58,
          writing: 0.5
        },
        benchmarks: {
          general: 74,
          coding: 86,
          reasoning: 70,
          verification: 66,
          writing: 58
        },
        pricing: {
          inputUsdPer1M: 0.27,
          outputUsdPer1M: 1.1
        },
        performance: {
          throughput: { p50: 92, p90: 56 },
          latency: { p50: 1.1, p90: 3.2 }
        },
        availability: 0.82,
        upstream: {
          provider: {
            sort: {
              by: "price",
              partition: "none"
            },
            preferred_min_throughput: { p90: 40 },
            allow_fallbacks: true
          }
        }
      },
      {
        id: "verifier-default",
        role: "verifier",
        model: "google/gemini-2.5-pro",
        description: "Verification candidate for risks, edge cases, and safety checks.",
        skills: {
          general: 0.7,
          coding: 0.66,
          reasoning: 0.78,
          verification: 0.9,
          writing: 0.64
        },
        benchmarks: {
          general: 86,
          coding: 76,
          reasoning: 84,
          verification: 90,
          writing: 72
        },
        pricing: {
          inputUsdPer1M: 1.25,
          outputUsdPer1M: 10
        },
        performance: {
          throughput: { p50: 42, p90: 24 },
          latency: { p50: 2.0, p90: 6.0 }
        },
        availability: 0.8,
        upstream: {
          provider: {
            sort: "price",
            allow_fallbacks: true
          }
        }
      },
      {
        id: "writer-default",
        role: "writer",
        model: "openai/gpt-4.1",
        description: "Synthesis candidate for final answers, docs, and polished writing.",
        skills: {
          general: 0.78,
          coding: 0.62,
          reasoning: 0.72,
          verification: 0.62,
          writing: 0.9
        },
        benchmarks: {
          general: 84,
          coding: 70,
          reasoning: 76,
          verification: 68,
          writing: 90
        },
        pricing: {
          inputUsdPer1M: 2,
          outputUsdPer1M: 8
        },
        performance: {
          throughput: { p50: 62, p90: 38 },
          latency: { p50: 1.2, p90: 3.8 }
        },
        availability: 0.85,
        upstream: {
          provider: {
            sort: "price",
            allow_fallbacks: true
          }
        }
      }
    ]
  },
  fusion: {
    minPanel: 2,
    maxPanel: 4,
    judgeRole: "verifier",
    synthesizerRole: "writer",
    toolRole: "writer",
    maxUpstreamCalls: 6,
    costEstimate: {
      inputTokensPerCall: 2000,
      outputTokensPerCall: 1000,
      maxUsd: null
    },
    timeoutMs: 90000
  }
};
