import {bridgeRequest} from './_bridge.mjs';
export default async function handler(req,res){return bridgeRequest(req,res,{route:'/api/state'});}
