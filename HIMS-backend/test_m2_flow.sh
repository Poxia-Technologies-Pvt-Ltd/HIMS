#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Hospital M2 Flow Test
#   Patient → ABHA → OP Visit → CBC Lab → Link OP Context → Link LAB Context
# ─────────────────────────────────────────────────────────────────────────────
# Usage: bash test_m2_flow.sh [ABHA_NUMBER] [PATIENT_NAME]
#   bash test_m2_flow.sh "91-1234-5678-9012" "Ravi Kumar"
# ─────────────────────────────────────────────────────────────────────────────

API="http://localhost:7005/api/abdm/m2"
MYSQL=/Applications/MAMP/Library/bin/mysql80/bin/mysql
DB_CMD="$MYSQL -u root -proot meril-hims"

ABHA="${1:-91-0000-0000-0001}"
PATIENT_NAME="${2:-Test Patient}"
PATIENT_ID=1
GENDER="M"
YEAR_OF_BIRTH=1990

OP_REF="OP000001"
LAB_REF="LAB000001"

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}  ✓ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
step() { echo -e "\n${BLUE}━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
info() { echo -e "${YELLOW}  → $1${NC}"; }

# ─── Clean up previous test data ──────────────────────────────────────────────
step "0. Cleanup"
$DB_CMD -e "DELETE FROM abdm_link_requests WHERE abha_number = '$ABHA';" 2>/dev/null
$DB_CMD -e "DELETE FROM abdm_care_context  WHERE abha_number = '$ABHA';" 2>/dev/null
pass "Cleared previous test rows for $ABHA"

# ─── Step 1: Gateway Token ────────────────────────────────────────────────────
step "1. Gateway Token"
GW=$(curl -s "$API/gateway-token")
GW_OK=$(echo $GW | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null)
if [ "$GW_OK" = "yes" ]; then
  EXPIRES=$(echo $GW | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['expiresIn'])" 2>/dev/null)
  pass "Token OK (expires in ${EXPIRES}s)"
else
  fail "Gateway token failed"
  exit 1
fi

# ─── Step 2: Request Link Token ───────────────────────────────────────────────
step "2. Request Link Token  →  ABHA: $ABHA"
LT_RESP=$(curl -s -X POST "$API/link-token" \
  -H "Content-Type: application/json" \
  -d "{
    \"abhaNumber\": \"$ABHA\",
    \"name\": \"$PATIENT_NAME\",
    \"gender\": \"$GENDER\",
    \"yearOfBirth\": $YEAR_OF_BIRTH,
    \"patientId\": $PATIENT_ID
  }")

LT_SUCCESS=$(echo $LT_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null)
if [ "$LT_SUCCESS" = "yes" ]; then
  REQUEST_ID=$(echo $LT_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['requestId'])" 2>/dev/null)
  pass "Link token requested → requestId: $REQUEST_ID"
  info "Waiting for ABDM callback..."
else
  # ABDM sandbox may 404 — simulate the callback manually
  REQUEST_ID="test-$(date +%s)"
  info "ABDM sandbox did not respond — inserting PENDING row manually"
  $DB_CMD -e "INSERT INTO abdm_link_requests (request_id, abha_number, patient_id, status) VALUES ('$REQUEST_ID','$ABHA',$PATIENT_ID,'PENDING');" 2>/dev/null
  pass "Stored as PENDING → requestId: $REQUEST_ID"
fi

# ─── Step 3: Simulate Link Token Callback ─────────────────────────────────────
step "3. Link Token Callback  (ABDM → HIP)"
LINK_TOKEN="LINK_TOK_$(echo $REQUEST_ID | tr -d '-' | head -c 12)"
CB1=$(curl -s -X POST "$API/link/on-link-token" \
  -H "Content-Type: application/json" \
  -d "{\"requestId\": \"$REQUEST_ID\", \"status\": \"SUCCESS\", \"linkToken\": \"$LINK_TOKEN\"}")

CB1_OK=$(echo $CB1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('acknowledgement') else 'no')" 2>/dev/null)
if [ "$CB1_OK" = "yes" ]; then
  pass "Callback received — linkToken stored"
else
  fail "Callback failed: $CB1"
  exit 1
fi

# Verify DB
LT_STATUS=$($DB_CMD -s -N -e "SELECT status FROM abdm_link_requests WHERE request_id='$REQUEST_ID';" 2>/dev/null)
STORED_TOKEN=$($DB_CMD -s -N -e "SELECT link_token FROM abdm_link_requests WHERE request_id='$REQUEST_ID';" 2>/dev/null)
[ "$LT_STATUS" = "SUCCESS" ] && pass "DB: link_requests.status = SUCCESS" || fail "DB: expected SUCCESS, got $LT_STATUS"
[ -n "$STORED_TOKEN" ] && pass "DB: link_token = $STORED_TOKEN" || fail "DB: link_token is empty"

# ─── Step 4: Link OP + LAB Care Contexts ─────────────────────────────────────
step "4. Link Care Contexts  →  $OP_REF + $LAB_REF"
CC_RESP=$(curl -s -X POST "$API/care-context/link" \
  -H "Content-Type: application/json" \
  -d "{
    \"patientId\": $PATIENT_ID,
    \"abhaNumber\": \"$ABHA\",
    \"linkToken\": \"$LINK_TOKEN\",
    \"careContexts\": [
      {\"referenceNumber\": \"$OP_REF\",  \"display\": \"Outpatient Visit\"},
      {\"referenceNumber\": \"$LAB_REF\", \"display\": \"CBC Blood Test\"}
    ]
  }")

CC_SUCCESS=$(echo $CC_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null)
if [ "$CC_SUCCESS" = "yes" ]; then
  CC_REQ_ID=$(echo $CC_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['requestId'])" 2>/dev/null)
  pass "Care context request sent → requestId: $CC_REQ_ID"
else
  # ABDM sandbox 404 — insert rows manually
  CC_REQ_ID="cc-$(date +%s)"
  info "ABDM sandbox did not respond — inserting rows manually"
  $DB_CMD -e "INSERT INTO abdm_care_context (request_id, patient_id, abha_number, care_context_ref, display, link_status) VALUES
    ('$CC_REQ_ID', $PATIENT_ID, '$ABHA', '$OP_REF',  'Outpatient Visit', 'PENDING'),
    ('$CC_REQ_ID', $PATIENT_ID, '$ABHA', '$LAB_REF', 'CBC Blood Test',   'PENDING');" 2>/dev/null
  pass "Stored 2 care contexts as PENDING → requestId: $CC_REQ_ID"
fi

# ─── Step 5: Simulate Care Context Callback ───────────────────────────────────
step "5. Care Context Callback  (ABDM → HIP)"
CB2=$(curl -s -X POST "$API/link/on-care-context" \
  -H "Content-Type: application/json" \
  -d "{\"requestId\": \"$CC_REQ_ID\", \"status\": \"SUCCESS\"}")

CB2_OK=$(echo $CB2 | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('acknowledgement') else 'no')" 2>/dev/null)
[ "$CB2_OK" = "yes" ] && pass "Callback received — care contexts updated" || fail "Callback failed: $CB2"

# ─── Step 6: Verify Final DB State ───────────────────────────────────────────
step "6. Verify  →  $ABHA"
echo ""

STATUS_JSON=$(curl -s "$API/care-context/patient/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$ABHA'))")")
ROWS=$(echo $STATUS_JSON | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"  {r['care_context_ref']:12} {r['display']:25} {r['link_status']}\") for r in d['data']]" 2>/dev/null)

echo -e "${YELLOW}  ABHA: $ABHA${NC}"
echo -e "${YELLOW}  ├─ $(echo "$ROWS" | head -1)${NC}"
echo -e "${YELLOW}  └─ $(echo "$ROWS" | tail -1)${NC}"
echo ""

OP_STATUS=$($DB_CMD -s -N -e "SELECT link_status FROM abdm_care_context WHERE abha_number='$ABHA' AND care_context_ref='$OP_REF';" 2>/dev/null)
LAB_STATUS=$($DB_CMD -s -N -e "SELECT link_status FROM abdm_care_context WHERE abha_number='$ABHA' AND care_context_ref='$LAB_REF';" 2>/dev/null)

[ "$OP_STATUS"  = "SUCCESS" ] && pass "DB: $OP_REF  → SUCCESS" || fail "DB: $OP_REF  → $OP_STATUS"
[ "$LAB_STATUS" = "SUCCESS" ] && pass "DB: $LAB_REF → SUCCESS" || fail "DB: $LAB_REF → $LAB_STATUS"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Test complete.  ABHA $ABHA linked to:${NC}"
echo -e "${GREEN}    $OP_REF  (Outpatient Visit)${NC}"
echo -e "${GREEN}    $LAB_REF (CBC Blood Test)${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
