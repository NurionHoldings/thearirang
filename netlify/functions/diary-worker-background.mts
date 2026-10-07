import {runDiary} from './_shared/diary.mjs';
export default async function handler(req:Request){let b;try{b=await req.json()}catch{return}if(!b||typeof b.id!=='string'||!/^diary-[a-f0-9-]{36}$/.test(b.id)||typeof b.secret!=='string'||b.secret.length!==64)return;await runDiary(b.id,b.secret)}
