import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Development uses the existing OMH loopback dashboard; there is no fake AI
// endpoint and no provider credentials in the frontend bundle.
export default defineConfig({
 plugins:[react()],
 base:process.env.OMH_PAGES_PREVIEW==='1'?'/openmind-harness/':'/',
 server:{host:'127.0.0.1',port:5180,strictPort:true,
  proxy:{'/api':{target:'http://127.0.0.1:4177',changeOrigin:true,
   configure(proxy){proxy.on('proxyReq',(request)=>{request.setHeader('Origin','http://127.0.0.1:4177');});}
  }}
 },
 build:{outDir:'dist',emptyOutDir:true}
});
