import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
const root=path.resolve(import.meta.dirname,'..');
const role='kitty_context_worker';
const adminFile=path.resolve(process.argv[2]||path.join(root,'.tooling/aiven-admin.json'));
const caFile=path.resolve(process.argv[3]||path.join(root,'.tooling/aiven-ca.pem'));
const appFile=path.join(root,'.tooling/aiven-worker.json');
let admin,app;
try {
  const settings=JSON.parse(await fs.readFile(adminFile,'utf8'));
  const ca=await fs.readFile(caFile,'utf8');
  const certificate=new crypto.X509Certificate(ca);
  if(!certificate.verify(certificate.publicKey))throw Error('Invalid CA');
  admin=new pg.Client({...settings,ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:10000});
  await admin.connect();
  let worker=await fs.readFile(appFile,'utf8').then(JSON.parse).catch(()=>null);
  const exists=(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount>0;
  if(exists&&!worker)throw Error('Restore the existing private worker credential file before setup.');
  if(!exists) {
    worker={host:settings.host,port:settings.port,database:settings.database,user:role,password:crypto.randomBytes(24).toString('hex')};
    // Password is generated hex, never printed or taken from an unescaped SQL input.
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${worker.password}' NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await fs.writeFile(appFile,JSON.stringify(worker),{mode:0o600});
  }
  await admin.query('BEGIN');
  await admin.query(await fs.readFile(path.join(root,'backend/postgres/001_context.sql'),'utf8'));
  await admin.query('COMMIT');
  app=new pg.Client({...worker,ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:10000});
  await app.connect();
  const synthetic='qa-context-'+crypto.randomUUID();
  await app.query('BEGIN');
  await app.query("SELECT set_config('kitty.uid',$1,true)",[synthetic]);
  await app.query('INSERT INTO kitty_context.accounts(uid) VALUES($1)',[synthetic]);
  await app.query('INSERT INTO kitty_context.summaries(uid,conversation_id,revision,context) VALUES($1,$2,1,$3)',[synthetic,'test',JSON.stringify({facts:['Prefers concise answers'],goals:[],topic:'Synthetic connectivity check'})]);
  const own=(await app.query('SELECT uid FROM kitty_context.summaries WHERE uid=$1',[synthetic])).rowCount;
  await app.query("SELECT set_config('kitty.uid',$1,true)",['qa-another-account']);
  const other=(await app.query('SELECT uid FROM kitty_context.summaries WHERE uid=$1',[synthetic])).rowCount;
  await app.query('ROLLBACK');
  if(own!==1||other!==0)throw Error('Row isolation test failed');
  console.log(JSON.stringify({tlsVerified:true,restrictedRoleReady:true,summaryWriteRead:true,crossAccountIsolation:true,syntheticDataRolledBack:true}));
} catch(e) {
  await admin?.query('ROLLBACK').catch(()=>{});
  await app?.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({setupSucceeded:false,errorType:e.code||e.name}));
  process.exitCode=1;
} finally {await app?.end().catch(()=>{});await admin?.end().catch(()=>{});}
