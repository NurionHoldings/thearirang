import {createDecipheriv} from 'node:crypto';
import {seed} from './_shared/opening-proposal-seed.mjs';
import {getStore,getDeployStore} from '@netlify/blobs';
import type {Config} from '@netlify/functions';
import {identityAdmin,floorSession} from './_shared/floor-access.mjs';
import {productionContext} from './_shared/deploy-context.mjs';
import {createProposalHandler} from './_shared/opening-proposal.mjs';
const handler=createProposalHandler({
  seedRevision:'arirang-letterhead-v1.1',
  seed:async()=>{const encoded=Netlify.env.get('ARIRANG_PROPOSAL_KEY_20261102_V2');if(!encoded)return null;const key=Buffer.from(encoded,'base64');if(key.length!==32)throw new Error('Invalid proposal key');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(seed.iv,'base64'));decipher.setAuthTag(Buffer.from(seed.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(seed.data,'base64')),decipher.final()]);},
  authorize:async(req:Request)=>{const owner=await identityAdmin(req);if(owner)return owner;const floor=await floorSession(req);return floor?.floor==='1'?floor.actor:'';},
  store:()=>{const options={name:'arirang-opening-proposal',consistency:'strong' as const};return productionContext()?getStore(options):getDeployStore(options);}
});
export default handler;
export const config:Config={path:['/private-opening-proposal','/private-opening-proposal/download'],rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
