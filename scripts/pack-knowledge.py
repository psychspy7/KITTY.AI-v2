import json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent.parent;out=root/'.tooling/knowledge'
source=out/'documents.raw.jsonl'
if not source.exists():(out/'documents.jsonl').rename(source)
count=0;total=0;maximum=0;entries=[];keywords=[];size=0
f=(out/'documents.jsonl').open('w',encoding='utf-8')
def emit():
 global entries,keywords,size,count,total,maximum
 if not entries:return
 content=json.dumps(entries,ensure_ascii=False,separators=(',',':'))
 d={'id':hashlib.sha256(content.encode()).hexdigest(),'title':entries[0]['title'],'content':content,'keywords':list(dict.fromkeys(keywords))[:32],'published':True,'source':entries[0]['source'],'license':'CC-BY-SA-3.0; Wikipedia contributors; adapted WikiText','snapshot':'Historical WikiText-103','revision':entries[0]['revision']}
 maximum=max(maximum,len(content.encode()));f.write(json.dumps(d,ensure_ascii=False)+'\n');count+=1;total+=sum(len(x['content'].encode()) for x in entries);entries=[];keywords=[];size=0
with source.open(encoding='utf-8') as rows:
 for line in rows:
  x=json.loads(line);n=len(x['content'].encode())
  if size+n>62000:emit()
  entries.append({k:x[k] for k in ['title','content','source','revision']});keywords.extend(x['keywords']);size+=n
emit();f.close()
m=json.loads((out/'manifest.json').read_text());m.update(documents=count,contentBytes=total,maxStoredChunkBytes=maximum,packedWithPerArticleAttribution=True)
(out/'manifest.json').write_text(json.dumps(m,indent=2));print(json.dumps(m))
if count>18000 or maximum>85000:raise RuntimeError('Free-quota or chunk-size safety limit exceeded')
