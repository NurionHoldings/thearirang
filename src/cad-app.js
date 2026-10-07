import {login,getUser} from '@netlify/identity';
window.ARIRANG_CAD_AUTH={login,getUser};
await import('../public/cad-editor.js');
