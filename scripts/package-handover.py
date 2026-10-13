"""Shareable configured handover. Whitelisted source, signed APK and public corpus only."""
import json,hashlib
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'.tooling/repository-manifest.json').read_text(encoding='utf-8'))
paths={e['path'] for e in manifest['text']+manifest['binary']}
paths.add('android/app/google-services.json')
if (root/'assets/brand/kitty-icon-master.png').is_file():paths.add('assets/brand/kitty-icon-master.png')
extras={'.tooling/knowledge/documents.jsonl':'KITTY-AI/public-reference-library/documents.jsonl','artifacts/KITTY-AI-2.0.0.apk':'KITTY-AI/install/KITTY-AI-2.0.0.apk'}
report=json.loads((root/'knowledge/manifest.json').read_text())
assert report['contentBytes']==500000000 and report['documents']==10056
out=root/'artifacts/KITTY-AI-2.0.0-HANDOVER.zip';temporary=out.with_suffix('.tmp.zip')
with ZipFile(temporary,'w',compression=ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
 for name in sorted(paths):
  path=(root/name).resolve()
  if not path.is_relative_to(root) or not path.is_file():raise RuntimeError('Invalid source path')
  if path.name in {'.env.local','.vault-key.local','keystore.properties'} or path.suffix in {'.dpapi','.jks','.keystore','.key','.p12','.pfx'}:raise RuntimeError('Private source path refused')
  archive.write(path,'KITTY-AI/'+name)
 for src,dst in extras.items():archive.write(root/src,dst)
with ZipFile(temporary) as archive:
 if archive.testzip() is not None:raise RuntimeError('Archive integrity check failed')
 names=archive.namelist()
 assert 'KITTY-AI/docs/CONTINUATION-PROMPT.txt' in names
 assert 'KITTY-AI/knowledge/manifest.json' in names
 assert 'KITTY-AI/firebase/firestore.rules' in names
 assert 'KITTY-AI/firebase/firestore.indexes.json' in names
 assert not any('.tooling/' in n or '.env.local' in n or '.jks' in n for n in names)
temporary.replace(out)
h=hashlib.sha256()
with out.open('rb') as f:
 for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
print(json.dumps({'archive':str(out),'bytes':out.stat().st_size,'files':len(names),'sha256':h.hexdigest(),'includesPublicCorpus':True,'privateCredentialsIncluded':False}))
