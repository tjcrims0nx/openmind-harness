import {bridgeRequest} from './_bridge.mjs';
const allowed=new Set(['cancel','retry','pause','disable','reject']);
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body)||!allowed.has(body.action))return res.status(403).json({error:'Action unavailable'});
 return bridgeRequest(req,res,{route:'/api/actions',methods:['POST']});
}
