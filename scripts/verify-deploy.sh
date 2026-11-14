#!/usr/bin/env bash
# Smoke-checks the deployed site: the public snapshot loads with no login, and the live functions need the owner's key
# (SPEC-public-release, ADR-0006).
# Usage: scripts/verify-deploy.sh [base-url] [old-deploy-permalink]   (key read from LIVE_ACCESS_KEY in .env)
# The permalink of a deploy made before the key check (https://<deploy-id>--<site>.netlify.app) must be refused: deleted
# (404) or protected (401), never served (checkpoint C security review).
set -euo pipefail

BASE="${1:-https://gp-report-intelligence.netlify.app}"
OLD="${2:-}"
cd "$(dirname "$0")/.."
KEY="$(grep -E '^LIVE_ACCESS_KEY=' .env 2>/dev/null | cut -d= -f2- || true)"
[[ -n "$KEY" ]] || { echo "LIVE_ACCESS_KEY missing from .env" >&2; exit 2; }

# The key goes to curl through a private header file, never on the command line (where ps would show it).
AUTH="$(mktemp)"; WRONG="$(mktemp)"; trap 'rm -f "$AUTH" "$WRONG"' EXIT; chmod 600 "$AUTH"
printf 'authorization: Bearer %s\n' "$KEY" > "$AUTH"
printf 'authorization: Bearer %s\n' "not-the-key-not-the-key-not-the-key" > "$WRONG" # 35 characters, never valid
fail=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }

check "public: the app shell loads with no login" '[[ $(curl -s -o /dev/null -w "%{http_code}" "$BASE/") == 200 ]]'
check "gate: an API call without the key is refused" \
  '[[ $(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health") == 401 ]]'
check "gate: an API call with a wrong key is refused" \
  '[[ $(curl -s -o /dev/null -w "%{http_code}" -H @"$WRONG" "$BASE/api/health") == 401 ]]'

HEADERS="$(curl -s -D - -o /dev/null "$BASE/")"
check "headers: CSP present"          'grep -qi "^content-security-policy:.*frame-ancestors .none." <<<"$HEADERS"'
check "headers: X-Frame-Options DENY" 'grep -qi "^x-frame-options: DENY" <<<"$HEADERS"'
check "app: shell is served"          'curl -s "$BASE/" | grep -q "<div id=\"root\">"'
check "app: deep link to a run page"   'curl -s "$BASE/runs/00000000-0000-4000-8000-000000000000" | grep -q "<div id=\"root\">"'

HEALTH="$(curl -s -w "\n%{http_code}" -H @"$AUTH" "$BASE/api/health")"
echo "      health -> $(head -1 <<<"$HEALTH") [$(tail -1 <<<"$HEALTH")]"
check "health: JSON with status field" 'head -1 <<<"$HEALTH" | grep -q "\"status\":"'
check "health: no secret leaked"       '! grep -qE "sk-ant-|sb_secret_|service_role" <<<"$HEALTH"'
check "health: db and storage ok"     'head -1 <<<"$HEALTH" | grep -q "\"checks\":{\"db\":\"ok\",\"storage\":\"ok\"}"'

DOCS="$(curl -s -H @"$AUTH" "$BASE/api/documents")"
check "documents: corpus listed"       'grep -q "\"doc_id\":\"alpenrose-iv-2026q2\"" <<<"$DOCS"'
check "documents: internals hidden"    '! grep -qE "sha256|storage_path" <<<"$DOCS"'

check "background: invocation accepted (202)" \
  '[[ $(curl -s -o /dev/null -w "%{http_code}" -H @"$AUTH" -X POST "$BASE/api/ping-background") == 202 ]]'

# End to end through the deployed pipeline on a clean dev document. Its LLM answers are in llm_cache, so this costs
# $0 and needs ~20 s; a regression in any step (or in the bundle) shows up as a status other than posted.
DOC_ID="$(python3 -c 'import json,sys; print([d["id"] for d in json.load(sys.stdin)["documents"] if d["filename"]=="alpenrose-iv-2026q1.pdf"][0])' <<<"$DOCS")"
RUN_ID="$(curl -s -H @"$AUTH" -X POST "$BASE/api/runs" -H 'content-type: application/json' -d "{\"document_id\":\"$DOC_ID\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("run_id", ""))')"
check "pipeline: run created" '[[ -n "$RUN_ID" ]]'
if [[ -n "$RUN_ID" ]]; then
  curl -s -o /dev/null -H @"$AUTH" -X POST "$BASE/api/runs/$RUN_ID/execute"
  for _ in $(seq 1 60); do
    RUN="$(curl -s -H @"$AUTH" "$BASE/api/runs/$RUN_ID")"
    STATUS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["run"]["status"])' <<<"$RUN")"
    [[ "$STATUS" == queued || "$STATUS" == running || "$STATUS" == ready_to_post ]] || break # ready_to_post: posting follows
    sleep 3
  done
  echo "      run $RUN_ID -> $STATUS"
  check "pipeline: clean dev document is auto-posted (step 8)" '[[ "$STATUS" == posted ]]'
  check "pipeline: all seven steps recorded" '[[ $(python3 -c "import json,sys; print(len(json.load(sys.stdin)[\"steps\"]))" <<<"$RUN") == 7 ]]'
fi

if [[ -n "$OLD" ]]; then
  check "old deploy: its functions are not reachable" \
    '[[ $(curl -s -o /dev/null -w "%{http_code}" "$OLD/api/health") =~ ^(401|404)$ ]]'
fi

exit $fail
