# Browser regression tests

Optional. They need Chrome and `playwright-core`, which is not a project dependency.

```bash
# one-time, outside the project
mkdir -p /tmp/mtg-pw && (cd /tmp/mtg-pw && npm init -y >/dev/null && npm i playwright-core@1.48.2)
export PW_CORE=/tmp/mtg-pw/node_modules/playwright-core

# 1. Player behaviour for every case (stage pauses, navigation, continuous replay, focus, keyboard, 390px)
python3 -m http.server 8000 --bind 127.0.0.1 --directory app &
node tests/browser/regress.cjs http://127.0.0.1:8000/

# 2. AI status states: static (8000), Node without AI (8001), Node with a local MOCK model (8002), file://
node tests/browser/mock-openai.cjs &            # fake OpenAI-compatible endpoint on 127.0.0.1:8099
PORT=8001 node server/server.cjs &
PORT=8002 MTG_AI_BASE_URL=http://127.0.0.1:8099/openai/v1 MTG_AI_API_KEY=mock-key MTG_AI_MODEL=mock-deploy node server/server.cjs &
node tests/browser/ai-ui.cjs
```

The mock returns the offline template text with a "[mock model]" prefix. Passing test 2 proves the UI and server wiring, not that a real Foundry deployment works.
