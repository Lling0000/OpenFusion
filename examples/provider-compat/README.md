# Provider Compatibility Example

Provider compatibility is part of OpenFusion's trust story. A relay can accept `/chat/completions` but still differ on streaming, tool calls, usage chunks, headers, or model aliases.

## 1. Start The Local Dry-Run Server

```bash
openfusion serve --dry-run --port 8787
```

## 2. Run The Local Matrix

```bash
openfusion compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion"
```

Expected result:

```md
# OpenFusion Provider Compatibility Matrix

| Target | Model | `probe.models` | `probe.chat` | `probe.chat.stream` | `probe.tool.roundtrip` |
| --- | --- | --- | --- | --- | --- |
| local | `openfusion/fusion` | PASS | PASS | PASS | PASS |

Overall: **PASS**
```

## 3. Compare Real Relays

Edit [compat.config.example.json](../compat.config.example.json), then run:

```bash
openfusion compat --compat-config examples/compat.config.example.json
```

For inline targets:

```bash
openfusion compat \
  --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" \
  --target "your-relay|https://your-relay.example.com/v1|your-default-model|YOUR_RELAY_API_KEY"
```

## 4. Publish A Report

1. Copy the matrix output into `docs/providers/<provider>.md`.
2. Include date, OpenFusion commit, provider or relay version, command used, result, and notes.
3. Run `npm run check:providers`.

Use [docs/providers/README.md](../../docs/providers/README.md) as the report template.
