# -*- coding: utf-8 -*-
import json, glob, os, re, collections, sys
ROOT = r"C:\Users\user\orca\workspaces\testautocreator\handoff-a-index\scripts\qa\reports"

# 1) ok:false 중 소문항/물음 누락류 수집
solved = sorted(glob.glob(os.path.join(ROOT,"answer-solved","*.json")))
batches = {os.path.basename(p): json.load(open(p,encoding="utf-8"))
           for p in glob.glob(os.path.join(ROOT,"answer-batches","*.json"))}

SUB = re.compile(r"소문항|물음|발문|문항.*잘|구하는지|묻는지|무엇을")
FIG = re.compile(r"그림|그래프|표|도수분포|산점도|히스토그램|보기|선택지|전개도|자료")

total_false = 0
cand = []   # (id, externalId, content)
byreason = collections.Counter()
for p in solved:
    name = os.path.basename(p)
    src = {r["id"]: r for r in batches.get(name, [])}
    for r in json.load(open(p, encoding="utf-8")):
        if r.get("ok"): continue
        total_false += 1
        why = r.get("why") or ""
        is_sub = bool(SUB.search(why))
        is_fig = bool(FIG.search(why))
        if is_sub and not is_fig:
            byreason[why[:40]] += 1
            s = src.get(r["id"])
            if s: cand.append((r["id"], s["externalId"], s["content"]))
            else: cand.append((r["id"], None, None))
print("ok:false 총", total_false)
print("소문항/물음 누락류", len(cand))
json.dump([{"id":a,"externalId":b,"content":c} for a,b,c in cand],
          open(os.path.join(os.path.dirname(ROOT),"_cand.json"),"w",encoding="utf-8"),
          ensure_ascii=False)
for w,c in byreason.most_common(12): print(c, w)
