# n8n-nodes-datasnack

The DataSnack node for [n8n](https://n8n.io). Put a [DataSnack](https://datasnack.ai) gate where your workflow used to
send every request to a large AI, or wait for a person: Jev (TypeSafe's fast model) answers, rules in a Go rule engine
check every answer, and what code cannot confirm goes to your own AI or a person, whose answer the gate learns from.

## Operations

- **Decide**: send a request to a gate. Map each input field (the fields, types and allowed values come from the gate)
  or send JSON. Two outputs:
  - **Confirmed**: tested rules gave the answer (on a text gate: Jev read the request and code confirmed its answer).
    The item has `output`, `reason`, `decided_by` and `decision_id`.
  - **Not confirmed**: no rule applies, so DataSnack gives no answer (`decided_by.tier` is `none`). Send it to your own
    AI model or a person, then record their answer. A request DataSnack could not decide (an error, with Continue On
    Fail) also comes out here.
- **Record the answer**: send back the answer your own AI or a person gave for a `decision_id`, saying who answered.
  The gate repeats it for the same request and drafts rules from it.
- **Observe**: for a gate that learns from your own system, send a request with the answer your system gave.

DataSnack's own AI only answers while a gate learns. Once a gate acts, every answer it gives is checked by code, and a
share is re-checked in the background so a rule that drifts is switched off.

Decide and Observe send an `Idempotency-Key` made from the execution, the node, its run and the item, so n8n's Retry On
Fail never decides twice. Set your own key (an order ID) under Options to be safe across executions too.

## Install

In n8n, open **Settings → Community Nodes → Install**, enter `n8n-nodes-datasnack` and install. On self-hosted n8n
without that page:

```sh
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install n8n-nodes-datasnack
# restart n8n
```

With Docker, run the same inside the container (`docker exec -it n8n sh`). Then create a **DataSnack API** credential
with a workspace API key from the dashboard's API keys page.

An example workflow that sends unconfirmed requests to your own AI:
[datasnack-n8n-example.json](https://datasnack.ai/assets/datasnack-n8n-example.json).

## Develop

```sh
npm ci
npm run lint      # n8n's community node checks
npm test          # builds, then runs the unit tests
```

Releases are staged on npm by GitHub Actions, with provenance, when a version tag is pushed: bump `version` in
`package.json`, commit, then `git tag 0.2.1 && git push --tags`. A maintainer then approves the staged version on
npmjs.com.

## License

MIT
