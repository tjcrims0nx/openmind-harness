import {bridgeRequest} from '../lib/omh-vercel-proxy.mjs';
export default async function handler(req,res){return bridgeRequest(req,res,{route:'/api/state'});}
