#!/bin/bash
# 푸시 전 자동 점검: 문법 · 빌드 문자열 · 표지 겹침 · 금지 상태(심볼릭 링크)
# 사용: (grader 폴더에서) bash tests/run_all.sh
cd "$(dirname "$0")/.." || exit 1
fail=0
echo "[1] 문법 검사"
for f in js/*.js AppsScript_Code.gs; do node -e "new Function(require('fs').readFileSync('$f','utf8'))" 2>/tmp/err.txt || { echo "  ✗ $f"; head -3 /tmp/err.txt; fail=1; }; done
for f in *.html; do node -e "const s=require('fs').readFileSync('$f','utf8');const m=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');new Function(m)" 2>/tmp/err.txt || { echo "  ✗ $f"; head -3 /tmp/err.txt; fail=1; }; done
echo "[2] 빌드 문자열 일치 (build.txt = $(cat build.txt))"
b=$(cat build.txt)
for f in *.html js/*.js; do for v in $(grep -o '2026[0-9]\{8\}' "$f" | sort -u); do [ "$v" != "$b" ] && { echo "  ✗ $f 에 옛 빌드 $v"; fail=1; }; done; done
echo "[3] 임시 심볼릭 링크 없음"
ls -l _m9.pdf _m10.pdf 2>/dev/null && { echo "  ✗ _m9/_m10 링크를 지우세요"; fail=1; }
echo "[4] 표지 겹침"
(python3 -m http.server 8772 >/dev/null 2>&1 & echo $! > /tmp/srv.pid); sleep 1
out=$(timeout 120 node tests/cover_check.js 2>&1 | tail -2); echo "  $out"; echo "$out" | grep -q "겹침 없음" || fail=1
kill $(cat /tmp/srv.pid) 2>/dev/null
[ $fail = 0 ] && echo "✅ 모두 통과" || { echo "❌ 실패 항목이 있어요"; exit 1; }
