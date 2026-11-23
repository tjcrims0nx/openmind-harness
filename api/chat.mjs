import {handleChat} from '../lib/omh-chat.mjs';
/** Web chat: authenticated provider routing, server-side keys only. */
export default async function handler(req,res){return handleChat(req,res);}
