import {login,logout,handleAuthCallback,acceptInvite,updateUser} from '@netlify/identity';
window.ARIRANG_AUTH={login:async(email,password)=>login(email,password),logout};
const form=document.querySelector('#login-form');
form.querySelector('p').textContent='초대받은 관리자 이메일과 비밀번호를 입력하세요.';
const label=document.createElement('label');label.textContent='이메일';const email=document.createElement('input');email.name='email';email.type='email';email.required=true;email.autocomplete='username';label.append(email);form.querySelector('label').before(label);
try{
 const result=await handleAuthCallback();
 if(result?.type==='invite'||result?.type==='recovery'){
 const dialog=document.createElement('dialog');dialog.innerHTML='<form><h2>관리자 비밀번호 설정</h2><label>새 비밀번호<input type="password" minlength="10" required autocomplete="new-password"></label><button>설정</button><p role="status"></p></form>';document.body.append(dialog);dialog.showModal();
 await new Promise(resolve=>{dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const password=dialog.querySelector('input').value;if(result.type==='invite')await acceptInvite(result.token,password);else await updateUser({password});dialog.close();resolve()}catch(error){dialog.querySelector('p').textContent=error.message}}});
 }
}catch(error){document.querySelector('#mode').textContent='계정 확인: '+error.message}
await import('../public/app.js');
