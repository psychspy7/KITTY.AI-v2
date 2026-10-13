import {createRequire} from 'node:module';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));process.env.XDG_CONFIG_HOME=join(root,'.tooling/account-config');
const require=createRequire(import.meta.url);const cli=join(process.env.APPDATA,'npm/node_modules/firebase-tools');
const auth=require(join(cli,'lib/auth.js'));const{requireAuth}=require(join(cli,'lib/requireAuth.js'));const{Client}=require(join(cli,'lib/apiv2.js'));
const account=auth.getGlobalDefaultAccount();if(account?.user?.email!=='viratanand1221@gmail.com')throw Error('Exact owner CLI session required');
await requireAuth({project:'kittyai-f743c',nonInteractive:true,user:account.user,tokens:account.tokens});
const api=new Client({urlPrefix:'https://serviceusage.googleapis.com',auth:true});
await api.post('/v1/projects/34203306703/services/firestore.googleapis.com:enable',{});
console.log('Firestore API enabled for the existing project; no billing account or paid product was added.');
