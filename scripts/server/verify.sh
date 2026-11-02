#!/usr/bin/env bash
# Checks a live address from outside (P12-DEPLOY-07, -11). Usage: scripts/verify.sh https://crm.explorehills.in [curl options]
set -uo pipefail
url="${1:?give the https address}"
shift
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2"; fail=1; fi; }
check "health answers" "$(curl -s "$@" -o /dev/null -w '%{http_code}' "$url/api/health")" 200
host_port="${url#https://}"
check "http goes to https" "$(curl -s "$@" -o /dev/null -w '%{http_code}' "${HTTP_CHECK_URL:-http://$host_port}/" )" 308
headers=$(curl -sI "$@" "$url/sign-in")
for name in strict-transport-security content-security-policy x-frame-options permissions-policy; do
  check "$name is set" "$(echo "$headers" | grep -ci "^$name:")" 1
done
check "microphone allowed for this site" "$(echo "$headers" | grep -i '^permissions-policy:' | grep -c 'microphone=(self)')" 1
check "server name hidden" "$(echo "$headers" | grep -ci '^server:')" 0
# Live updates must not be buffered: the signed-out refusal comes at once, and the stream's headers aren't compressed.
check "live updates refuse strangers" "$(curl -s "$@" -o /dev/null -w '%{http_code}' -m 5 "$url/api/events/stream")" 401
check "test routes are gone" "$(curl -s "$@" -o /dev/null -w '%{http_code}' "$url/api/test-support/fail")" 404
host="${host_port%%/*}"
end=$(echo | openssl s_client -connect "$host$([ "${host#*:}" = "$host" ] && echo :443)" -servername "${host%%:*}" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
echo "     certificate ends: ${end:-could not read}"
[ -n "$end" ] || fail=1
exit $fail
