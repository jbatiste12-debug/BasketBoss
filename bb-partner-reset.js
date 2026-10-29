/* QA-only password recovery. Never store reset tokens, emails, or passwords in localStorage. */
(()=>{'use strict';
 const EXPECTED_HOST='basketboss-partner-qa.pages.dev';
 const EXPECTED_URL='https://cbucbdvwgmkgmsajtbfe.supabase.co';
 const config=window.BASKETBOSS_CLOUD_CONFIG||{};
 const message=document.getElementById('message');
 const request=document.getElementById('request-section');
 const change=document.getElementById('change-section');
 const show=(msg,error=false)=>{message.textContent=msg;message.classList.toggle('error',error);};
 if(location.hostname!==EXPECTED_HOST || config.url!==EXPECTED_URL ||
    !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(config.anonKey||'')){
   show('QA password recovery is not available on this website.',true);return;
 }
 const api=(path,method,body,token)=>fetch(EXPECTED_URL+'/auth/v1/'+path,{
   method,redirect:'error',cache:'no-store',credentials:'omit',
   headers:{'apikey':config.anonKey,'Content-Type':'application/json',
    ...(token?{'Authorization':'Bearer '+token}:{})},
   body:body?JSON.stringify(body):undefined
 });
 const hash=new URLSearchParams(location.hash.slice(1));
 const query=new URLSearchParams(location.search);
 let recoveryToken=hash.get('type')==='recovery'?hash.get('access_token'):null;
 const resetError=hash.has('error')||query.has('error');
 // Remove credentials and Supabase errors from the address bar before making any network calls.
 if(location.hash||location.search)history.replaceState(null,'',location.pathname);
 if(recoveryToken){
   show('Verifying your recovery link…');
   api('user','GET',null,recoveryToken).then(async response=>{
     if(!response.ok)throw Error('The recovery link expired or was already used. Request another email.');
     const profile=await response.json();
     if(!profile?.id||!profile?.email_confirmed_at)throw Error('This recovery link is not valid.');
     change.hidden=false;show('Recovery link verified. Choose a new test password.');
   }).catch(()=>{recoveryToken=null;request.hidden=false;show('The recovery link could not be verified. Request a fresh email.',true);});
 }else{
   request.hidden=false;
   if(resetError)show('That recovery link expired or could not be verified. Request a fresh one.',true);
 }
 document.getElementById('request-form').addEventListener('submit',async event=>{
   event.preventDefault();const button=document.getElementById('send');
   const email=document.getElementById('email').value.trim();
   if(!email || email.length>254)return;
   button.disabled=true;show('Requesting a reset email…');
   try{
     const response=await api('recover?redirect_to='+encodeURIComponent('https://'+EXPECTED_HOST+'/reset-password.html'),'POST',{email});
     if(response.status===429)throw Error('Please allow a minute before requesting another email.');
     if(!response.ok)throw Error('Supabase could not send a reset email. Check the test project email settings.');
     show('If that test account exists and email delivery is permitted, a reset link will arrive shortly. Use the newest email.');
   }catch(error){show(error?.message||'Could not request the email. Please try again.',true)}
   finally{button.disabled=false;}
 });
 document.getElementById('change-form').addEventListener('submit',async event=>{
   event.preventDefault();if(!recoveryToken)return;
   const password=document.getElementById('password').value;
   const confirm=document.getElementById('confirm').value;
   if(password.length<12||password.length>128){show('Use a password between 12 and 128 characters.',true);return;}
   if(password!==confirm){show('Passwords do not match.',true);return;}
   const button=document.getElementById('change');button.disabled=true;show('Updating your test password…');
   try{
     const response=await api('user','PUT',{password},recoveryToken);
     const data=await response.json().catch(()=>({}));
     if(!response.ok||!data.id)throw Error('Could not update the password. Request a new recovery email and try again.');
     recoveryToken=null;
     document.getElementById('password').value='';document.getElementById('confirm').value='';
     change.hidden=true;
     show('Test password updated. Return to Partner QA and sign in using your new password.');
   }catch(error){show(error?.message||'Password update failed.',true);}
   finally{button.disabled=false;}
 });
})();
