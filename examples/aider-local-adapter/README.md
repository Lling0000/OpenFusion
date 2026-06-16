# Aider Local Adapter Example

This example is the copy-paste path for connecting Aider to a local OpenFusion dry-run server first, before using any real upstream relay key.

## 1. Start OpenFusion Locally

```bash
openfusion serve --dry-run --port 8787
```

From a git checkout:

```bash
node src/cli.js serve --dry-run --port 8787
```

## 2. Configure Aider

Option A: copy the environment variables from [env.example](env.example):

```bash
cp examples/aider-local-adapter/env.example .env.aider-local
```

Then export them in your shell:

```bash
set -a
. ./.env.aider-local
set +a
```

Option B: add the base URL and model to `~/.aider.conf.yml`, then keep the placeholder key in your shell environment:

```yaml
model: openai/openfusion/fusion
openai-api-base: http://127.0.0.1:8787/v1
```

Then export the placeholder key:

```bash
export AIDER_OPENAI_API_KEY="openfusion-local-placeholder"
```

The placeholder key is only for Aider talking to the local OpenFusion server. Keep your real upstream relay key on the OpenFusion server process, for example `OPENROUTER_API_KEY` or `YOUR_RELAY_API_KEY`.

## 3. Verify The Local Endpoint

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/fusion
```

Or run the helper script from the repository root:

```bash
./examples/aider-local-adapter/verify.sh
```

If your server uses a different port:

```bash
OPENFUSION_BASE_URL="http://127.0.0.1:18788/v1" ./examples/aider-local-adapter/verify.sh
```

## 4. Run Aider Through OpenFusion

Launch Aider from your project root:

```bash
export AIDER_OPENAI_API_BASE="http://127.0.0.1:8787/v1"
export AIDER_OPENAI_API_KEY="openfusion-local-placeholder"
aider --model openai/openfusion/fusion
```

Tool-call style turns stay in single-model passthrough mode so OpenFusion does not break the client protocol while ordinary assistant answers still benefit from fusion routing.
That preserves the tool protocol while keeping ordinary assistant answers on the fusion path.
