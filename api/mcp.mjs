import {bridgeRequest} from '../lib/omh-vercel-proxy.mjs';
/** Authenticated stateless MCP JSON-RPC endpoint for remote test clients. */
export default async function handler(req,res){return bridgeRequest(req,res,{route:'/mcp',methods:['POST']});}
