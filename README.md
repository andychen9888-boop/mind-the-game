# Mind the Game

**See the whole goal, not just the scorer.**

Football fans remember who scored and maybe who assisted. Mind the Game replays the move behind a goal on a 2D pitch, one stage at a time, and explains what each stage did — including the interception that started it, the run that never got the ball and the late arrival who finished it.

Built for the Microsoft *Inside the Game* hackathon.

## What you can do

- **Watch stage by stage.** The replay stops at the end of every stage. Read, then press *Next stage*. A continuous replay is available too.
- **Choose your depth.** *Simple view* explains in plain words for someone who has never played. *Tactical view* labels every sentence as observation, inference or unknown and links to the event IDs behind it.
- **Follow a player.** Select any player to keep their movement trail.
- **Switch perspective.** Top-down or a broadcast-like tilted view.
- **Read in English or Chinese.** The language follows the browser; `?lang=en` or `?lang=zh` forces one.
- **See every contribution.** A closing summary lists each player's role. It is a description, not a credit ranking.

## Cases

| Case | Data | Stages |
| --- | --- | --- |
| Counterattack: interception, through ball, cutback | Synthetic, fictional teams | 3 |
| Build-up: short goal kick, switch of play, cross, header | Synthetic, fictional teams | 5 |
| High press: two presses, tackle, quick shot | Synthetic, fictional teams | 2 |
| Anonymized real-match reconstruction | Positions estimated from broadcast footage of a real match; teams, players, kits and score replaced | 5 |

The three synthetic cases are the core of the project. They are produced by generators in `scripts/synthetic/` and are not derived from any real match. The anonymized case shows that the same player can also replay real footage after calibration. It is labelled as real-match-derived and is **not** synthetic data. No footage is included in this repository.

## How it works

```
synthetic match events + player positions every 0.5 s (players outside a simulated camera are null)
  ingest      scripts/pipeline/ingest.cjs             validate the input
  interpret   scripts/pipeline/interpret.cjs          split into stages with event rules; compute observable features
  explain     scripts/pipeline/explain-template.cjs   deterministic bilingual explanations
              scripts/pipeline/explain-ai.cjs         optional: model on Microsoft Foundry rewrites the beginner text
  render      scripts/pipeline/render-case.cjs        case file for the player
  personalize app/index.html                          simple / tactical, EN / 中文, player focus, 2D / tilted
```

**Stages come from events, not fixed time slices.** A stage boundary is placed at the first press or regain, the first entry into the middle and final thirds, a switch of play, and the final ball before the shot.

**Features are things the data can support.** Examples are how many visible opponents are ahead of the ball, which defenders a forward pass travelled past, how many opponents were near each side at a switch of play, and which runs started stages before the finish. A defender moving with a runner is reported as co-movement, never as cause.

**Guards against invented claims.** Every explanation, written by templates or by AI, passes `scripts/pipeline/validate-explanation.cjs`. It rejects:

- invented percentages, xG, speeds and distances;
- unknown shirt numbers;
- references to events outside the stage;
- markup;
- stages that hide off-camera players;
- explanations that drop an off-ball runner or a contributor's summary card.

### Microsoft Foundry (AI step)

When a model deployment is configured, the server can regenerate the beginner layer of a synthetic case live. The steps are:

1. An explainer agent rewrites the text. Structure, event references and contribution cards stay fixed by code.
2. The deterministic guard checks the result.
3. A reviewer agent fact-checks it against the features.
4. If there are problems, the explainer revises once and the reviewer checks again.

Anything that fails is discarded. The page then says so, with the reasons, and keeps the template text. It never presents template text as AI output.

Tested against Azure OpenAI in Microsoft Foundry (gpt-4o, Standard deployment, v1 Chat Completions with strict JSON schema). In our tests the guard and reviewer rejected most AI rewrites, mainly for causal or generic claims. **The shipped explanations are therefore the deterministic templates**, and AI regeneration is an optional, clearly labelled feature.

## Run it

Node.js 20.6 or newer. No `npm install` is needed.

| Mode | Command | AI |
| --- | --- | --- |
| Open the file | double-click `app/index.html` | Off: pre-generated explanations |
| Static server | `python3 -m http.server 8000 --directory app` | Off |
| Node server | `npm start` and open http://127.0.0.1:8000 | On when `.env` is configured |

```bash
cp .env.example .env    # MTG_AI_BASE_URL, MTG_AI_API_KEY, MTG_AI_MODEL (and optionally MTG_AI_TEMPERATURE)
npm start               # header shows "AI available"; About this replay → "Regenerate this case with AI"
```

The API key stays on the server and is never sent to the browser.

## Checks

```bash
npm run check
```

This covers the player script, every case file, reproducibility of all synthetic inputs and cases, the explanation guard against tampered output, the validator, the segmentation rules, and the AI agent loop against a mocked endpoint, including rate-limit and network retries. It also confirms that no secrets or media are in `app/`. Browser regression tests are in `tests/browser/`.

## Make your own synthetic goal

Write `scripts/synthetic/generate-<name>.cjs` using `scripts/synthetic/lib.cjs`. Involved players get waypoints and the rest follow the team shape. Then run:

```bash
node scripts/synthetic/generate-<name>.cjs
node scripts/pipeline/run.cjs data/synthetic/<name>.input.json
npm run build
```

The data format is described in `docs/SCHEMA.md`.

## Limits

- Synthetic positions are sampled every 0.5 s and linearly interpolated.
- The tilted view changes the drawing only. No heights are measured, and the arc of an aerial ball is illustrative.
- The anonymized reconstruction has unmeasured real-world position error. Goalkeepers are not detected there, and the ball is placed at the feet of the player in possession.
- No user research has been done yet; the claims about beginner understanding are design goals, not measured results.

## License

MIT. Generic avatars are drawn in code. No club marks, player likenesses or broadcast footage are included.
