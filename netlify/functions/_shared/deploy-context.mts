import {getContext} from '@netlify/functions';
/** Deployment context is runtime metadata; build-time CONTEXT is not guaranteed in Functions. */
export function productionContext(){
 try{const value=getContext().deploy.context;if(value)return value==='production';}catch{/* Unit tests/local tooling may not have request context. */}
 return Netlify.env.get('CONTEXT')==='production';
}
