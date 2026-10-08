#!/usr/bin/env bash
# Fails closed: any hit from this deny-list stops the build, because a leaked
# internal hostname is not something a reviewer will tell you about later.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERNS=(
  'bni'
  'bank[ _-]?negara'
  'gitlab-dc|jenkins-dc|nexus-dc'
  '\.co\.id|\.intra|\.corp\b'
  'devsecops1|kiro|idp-avatar|avatar'
  'swmp|cxo|cidm|bo-iam'
  'glpat-|ntauth'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|id|net|org)'
  '(10|172|192)\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'
  'BEGIN [A-Z ]*PRIVATE KEY'
)

# example.com is the sanctioned placeholder domain, so the email rule must not
# fire on it.
ALLOW='example\.com|example\.internal|localhost|127\.0\.0\.1'
FILES=$(git ls-files | grep -vE '^(node_modules/|package-lock\.json$)' || true)

fail=0
for p in "${PATTERNS[@]}"; do
  hits=$(grep -inE "$p" $FILES 2>/dev/null | grep -vE "$ALLOW" | grep -v 'check-sanitised.sh' || true)
  if [ -n "$hits" ]; then
    echo "DENY-LIST HIT: $p"
    echo "$hits" | head -5
    fail=1
  fi
done

# Credential-shaped literals: an assignment to a secret-ish name with a long
# quoted value. Placeholders using ${...} are fine by construction.
secret_hits=$(grep -rnEi "(password|secret|token|api[_-]?key)['\"]?[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9/+_.-]{16,}['\"]" $FILES 2>/dev/null | grep -vE 'change-me|demo-key|smoke-key|\$\{' || true)
if [ -n "$secret_hits" ]; then
  echo "DENY-LIST HIT: credential-shaped literal"
  echo "$secret_hits" | head -5
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "sanitisation gate FAILED"
  exit 1
fi
echo "sanitisation gate passed: $(echo "$FILES" | wc -l | tr -d ' ') tracked files clean"
