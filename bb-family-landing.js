/* Public-page navigation only. No account access, storage or network requests. */
(()=>{'use strict';
  const previousSections={'demo':'at-home','cook-demo':'at-home','cook-ideas':'premium','recipes':'premium','about-founder':'site-footer'};
  function revealLinkedSection(){
    if(!location.hash)return;
    let id;try{id=decodeURIComponent(location.hash.slice(1));}catch(_){return;}
    const direct=document.getElementById(id);
    const target=direct||document.getElementById(previousSections[id]);
    if(!target)return;
    const details=target.closest('details');
    if(details)details.open=true;
    if(!direct)target.scrollIntoView({block:'start',behavior:'auto'});
  }
  window.addEventListener('hashchange',revealLinkedSection);
  revealLinkedSection();
})();
