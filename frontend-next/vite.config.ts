import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Development uses the existing OMH loopback dashboard; there is no fake AI
// endpoint and no provider credentials in the frontend bundle.
export default defineConfig({
 plugins:[react()],
 server:{host:'127.0.0.1',port:5180,strictPort:true,
  proxy:{'/api':{target:'http://127.0.0.1:4177',changeOrigin:false}}
 },
 build:{outDir:'dist',emptyOutDir:true}
});
