import json, re, hashlib, collections, sys, time
from pathlib import Path
import requests
root=Path(__file__).resolve().parent.parent
out=root/'.tooling/knowledge';out.mkdir(parents=True,exist_ok=True)
meta=requests.get('https://huggingface.co/api/datasets/Salesforce/wikitext',timeout=30).json()
revision=meta['sha']; (out/'dataset-revision.json').write_text(json.dumps({'revision':revision,'source':'Salesforce/wikitext','license':'CC-BY-SA-3.0/GFDL'}))
for i in range(2):
    name=f'train-{i:05d}-of-00002.parquet';target=out/name
    if not target.exists():
        url=f'https://huggingface.co/datasets/Salesforce/wikitext/resolve/{revision}/wikitext-103-raw-v1/{name}'
        with requests.get(url,stream=True,timeout=120) as r:
            r.raise_for_status()
            with target.with_suffix('.part').open('wb') as f:
                for chunk in r.iter_content(1024*1024):f.write(chunk)
        target.with_suffix('.part').rename(target)
    print(f'Downloaded public dataset part {i+1}: {target.stat().st_size} bytes',flush=True)
sys.path.insert(0,str(root/'.tooling/python-libs'))
import pyarrow.parquet as pq
stop=set('the a an and or to of in for is are be with on from by as at this that it was were has have had not into their which its they when who what how why can would could your you'.split())
limit=500_000_000;total=0;count=0;title='WikiText reference';buffer=[];size=0;part=0;seen=set()
f=(out/'documents.jsonl').open('w',encoding='utf-8')
def emit():
    global total,count,buffer,size,part
    text='\n'.join(buffer).strip();buffer=[];size=0
    if not text or total>=limit:return
    text=text.encode('utf-8')[:limit-total].decode('utf-8',errors='ignore')
    digest=hashlib.sha256(text.encode()).hexdigest()
    if digest in seen:return
    seen.add(digest)
    words=re.findall(r'[a-z][a-z0-9]{2,30}',text.lower());freq=collections.Counter(w for w in words if w not in stop)
    terms=list(dict.fromkeys(re.findall(r'[a-z][a-z0-9]{2,30}',title.lower())+[w for w,n in freq.most_common(24)]))[:32]
    doc={'id':digest,'title':title[:180],'content':text,'keywords':terms,'published':True,'source':'https://en.wikipedia.org/wiki/'+requests.utils.quote(title.replace(' ','_'),safe=''),'license':'CC-BY-SA-3.0; Wikipedia contributors; adapted WikiText','snapshot':'WikiText-103 (historical corpus)','revision':revision}
    f.write(json.dumps(doc,ensure_ascii=False)+'\n');total+=len(text.encode());count+=1;part+=1
for i in range(2):
    for batch in pq.ParquetFile(out/f'train-{i:05d}-of-00002.parquet').iter_batches(batch_size=2048,columns=['text']):
        for raw in batch.column(0).to_pylist():
            text=raw.strip()
            if not text:continue
            match=re.fullmatch(r'= ([^=]+) =',text)
            if match:
                emit(); title=match[1].strip();part=0
            else:
                text=text.replace('@-@','-').replace('@,@',',').replace('@.@','.')
                n=len(text.encode())
                if size+n>62000:emit()
                buffer.append(text);size+=n+1
            if total>=limit:break
        if total>=limit:break
    if total>=limit:break
emit();f.close()
report={'source':'https://huggingface.co/datasets/Salesforce/wikitext','revision':revision,'license':'CC-BY-SA-3.0 / GFDL','contentBytes':total,'documents':count,'targetBytes':limit,'downloadBytes':sum((out/f'train-{i:05d}-of-00002.parquet').stat().st_size for i in range(2)),'deduplicated':True,'maxChunkBytes':62000,'preparedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'fineTuned':False}
(out/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if count>18000:raise RuntimeError('Import would exceed reserved free write budget; do not upload')
if total<limit:print('Corpus below target after cleanup; no filler added.',flush=True)
