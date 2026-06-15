# Codex Local Adapter Example

This example is the copy-paste path for connecting Codex to a local OpenFusion dry-run server first, before using any real upstream relay key.

## 1. Start OpenFusion Locally

```bash
openfusion serve --dry-run --port 8787
```

From a git checkout:

```bash
node src/cli.js serve --dry-run --port 8787
```

## 2. Add Codex Config

Copy [config.toml.example](config.toml.example) into your user-level Codex config:

```bash
mkdir -p ~/.codex
cat examples/codex-local-adapter/config.toml.example >> ~/.codex/config.toml
```

Codex provider settings belong in user-level `~/.codex/config.toml`. Do not put `model_provider` or `model_providers` in project `.codex/config.toml`.

## 3. Set A Local Placeholder Key

```bash
export OPENFUSION_API_KEY="openfusion-local-placeholder"
```

The placeholder is only for Codex talking to the local OpenFusion server. Keep your real upstream relay key on the OpenFusion server process, for example `OPENROUTER_API_KEY` or `YOUR_RELAY_API_KEY`.

## 4. Verify The Local Endpoint

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/fusion
```

Or run the helper script from the repository root:

```bash
./examples/codex-local-adapter/verify.sh
```

If your server uses a different port:

```bash
OPENFUSION_BASE_URL="http://127.0.0.1:18788/v1" ./examples/codex-local-adapter/verify.sh
```

## 5. Ask Codex To Use OpenFusion

After the config is loaded, Codex should send ordinary assistant-answer requests to:

```text
base_url = http://127.0.0.1:8787/v1
model = openfusion/fusion
```

Tool-call turns stay in single-model passthrough mode so Codex's tool protocol remains stable.
