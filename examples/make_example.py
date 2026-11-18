"""Writes the example n8n workflow that calls DataSnack with n8n's own HTTP Request and If nodes (for n8n Cloud, where
the DataSnack node cannot be installed yet): decide; what code confirms goes on; what it cannot goes to your own AI,
whose answer is sent back. Usage: python3 make_example.py BASE_URL OUT.json [CREDENTIAL_ID]"""
import json
import sys

base = sys.argv[1].rstrip('/')
out = sys.argv[2]
cred_id = sys.argv[3] if len(sys.argv) > 3 else None
cred = {"httpHeaderAuth": {"id": cred_id, "name": "DataSnack API key"}} if cred_id else {}
gate = "refund-emails"


def http(id_, name, pos, url, body, idem=False):
    p = {"method": "POST", "url": url, "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
         "sendBody": True, "specifyBody": "json", "jsonBody": body, "options": {}}
    if idem:
        p["sendHeaders"] = True
        p["headerParameters"] = {"parameters": [{"name": "Idempotency-Key", "value": "=n8n-{{ $execution.id }}-{{ $itemIndex }}"}]}
    n = {"id": id_, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos, "parameters": p,
         "retryOnFail": True, "maxTries": 3}
    if cred:
        n["credentials"] = cred
    return n


wf = {
    "name": "DataSnack: Jev answers, code checks, your AI takes the rest",
    "nodes": [
        {"id": "n1", "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {}},
        {"id": "n2", "name": "Example request", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0],
         "parameters": {"jsCode": "// Replace with your trigger's data, as the gate's input fields.\nreturn [\n  {json: {today: '2026-11-18', customer_tier: 'plus', email: 'Hi, the $40 lamp arrived last week and I changed my mind. Can I get a refund?'}},\n  {json: {today: '2026-11-18', customer_tier: 'standard', email: 'I want my money back for the thing I bought a while ago.'}},\n];"}},
        http("n3", "Decide", [440, 0], f"{base}/v1/gates/{gate}/decide", "={{ JSON.stringify({input: $json}) }}", idem=True),
        {"id": "n4", "name": "Not confirmed?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [660, 0],
         "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                       "conditions": [{"id": "c1", "leftValue": "={{ $json.decided_by.tier }}", "rightValue": "none",
                                                       "operator": {"type": "string", "operation": "equals"}}],
                                       "combinator": "and"}, "options": {}}},
        {"id": "n5", "name": "Your own AI", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, -100],
         "parameters": {"jsCode": "// Replace this node with your own AI (an OpenAI or Anthropic node) or an approval step (Slack, Gmail or Teams:\n// Send and wait for response), and map its answer to the gate's answer fields below.\nreturn $input.all().map(item => ({json: {\n  decision_id: item.json.decision_id,\n  answer: {decision: 'ask'},\n  source: 'model',\n  who: 'our AI'\n}}));"}},
        http("n6", "Record the answer", [1100, -100], f"={base}/v1/decisions/{{{{ $json.decision_id }}}}/feedback",
             "={{ JSON.stringify({output: $json.answer, source: $json.source, who: $json.who}) }}"),
        {"id": "n7", "name": "Use the answer", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "position": [880, 100], "parameters": {}},
        {"id": "n8", "name": "Note", "type": "n8n-nodes-base.stickyNote", "typeVersion": 1, "position": [160, -320],
         "parameters": {"width": 640, "height": 260, "content":
             "## DataSnack gate\n1. Create a **Header Auth** credential: name `Authorization`, value `Bearer dsk_...` (an API key from datasnack.ai/app/keys), and pick it in both HTTP nodes.\n2. Create the gate from the **Refund emails** template (or change `refund-emails` in **Decide** to your gate's slug).\n3. Once the gate acts, what code confirms comes out of the false branch; what it cannot comes out of the true branch.\n4. Replace **Your own AI** with your AI node or an approval step. The answer you record is repeated for the same request and the gate learns from it.\n\nDocs: datasnack.ai/docs#n8n"}},
    ],
    "connections": {
        "Start": {"main": [[{"node": "Example request", "type": "main", "index": 0}]]},
        "Example request": {"main": [[{"node": "Decide", "type": "main", "index": 0}]]},
        "Decide": {"main": [[{"node": "Not confirmed?", "type": "main", "index": 0}]]},
        "Not confirmed?": {"main": [[{"node": "Your own AI", "type": "main", "index": 0}], [{"node": "Use the answer", "type": "main", "index": 0}]]},
        "Your own AI": {"main": [[{"node": "Record the answer", "type": "main", "index": 0}]]},
    },
    "settings": {"executionOrder": "v1"},
    "pinData": {},
}
if cred_id:
    wf["id"] = "dsE2Eexample01"
with open(out, "w") as f:
    json.dump(wf, f, indent=2)
    f.write("\n")
