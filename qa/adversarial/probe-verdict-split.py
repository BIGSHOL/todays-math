import json, pathlib, collections

cands = json.loads(pathlib.Path('scripts/qa/reports/choice-figure-candidates.json').read_text(encoding='utf-8'))
pairs = json.loads(pathlib.Path('scripts/qa/reports/choice-figure-pairs.json').read_text(encoding='utf-8'))
grp = {c['id']: c['group'] for c in cands}

t = collections.Counter()
for p in pairs:
    t[(grp.get(p['id'], '?'), p['verdict'])] += 1
for k in sorted(t, key=lambda k: (k[0], k[1])):
    print('%-8s %-6s %4d' % (k[0], k[1], t[k]))

print()
print('== 보기그림 판정별 사유 ==')
w = collections.Counter()
for p in pairs:
    if grp.get(p['id']) == '보기그림' and p['verdict'] != '자동':
        w[(p['verdict'], p.get('why', ''))] += 1
for k, v in w.most_common():
    print('%4d  %s · %s' % (v, k[0], k[1]))

# 커밋된 원장과 대조
led = json.loads(pathlib.Path('scripts/qa/reports/choice-figure-index-apply.json').read_text(encoding='utf-8'))
mine = {p['id']: p.get('choiceFigureIndex') for p in pairs if p['verdict'] == '자동'}
theirs = {r['id']: r['after'] for r in led['rows']}
print()
print('== 커밋된 적재 원장 대조 ==')
print('원장 행수', len(theirs), ' 내 자동', len(mine))
only_mine = set(mine) - set(theirs)
only_theirs = set(theirs) - set(mine)
diff = [i for i in set(mine) & set(theirs) if mine[i] != theirs[i]]
print('나만', len(only_mine), '원장만', len(only_theirs), '값이 다름', len(diff))
for i in list(only_mine)[:10]:
    print('  나만:', i, mine[i])
for i in list(only_theirs)[:10]:
    print('  원장만:', i, theirs[i])
for i in diff[:10]:
    print('  다름:', i, mine[i], theirs[i])
