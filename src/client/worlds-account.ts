import {localeCookie,localeKey,messages,normalizeLocale,type Locale,type Message} from '../i18n/worlds';
const root=document.querySelector<HTMLElement>('[data-worlds-account]');
if(root){
 function apply(locale:Locale,save=false){
  document.documentElement.lang=locale;document.title=messages[locale].title;
  root!.querySelectorAll<HTMLElement>('[data-worlds-text]').forEach(node=>{const key=node.dataset.worldsText as Message;if(key in messages[locale])node.textContent=messages[locale][key];});
  root!.querySelectorAll<HTMLElement>('[data-worlds-label]').forEach(node=>{const key=node.dataset.worldsLabel as Message;if(key in messages[locale])node.setAttribute('aria-label',messages[locale][key]);});
  root!.querySelectorAll<HTMLButtonElement>('[data-worlds-locale]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.worldsLocale===locale)));
  root!.querySelectorAll<HTMLFormElement>('form').forEach(form=>{const url=new URL(form.action);url.searchParams.set('ui_locales',locale);form.action=url.pathname+url.search;});
  const privacy=root!.querySelector<HTMLAnchorElement>('[data-worlds-privacy]');if(privacy)privacy.href='https://worlds-hub.maki26.workers.dev/'+(locale==='en'?'en/privacy':'datenschutz');
  if(save){try{localStorage.setItem(localeKey,locale);}catch{}document.cookie=`${localeCookie}=${locale}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;}
 }
 let saved:Locale|undefined;try{saved=normalizeLocale(localStorage.getItem(localeKey));}catch{}
 const explicit=normalizeLocale(new URL(location.href).searchParams.get('ui_locales'));
 apply(explicit??saved??normalizeLocale(document.documentElement.lang)??'de');
 root.querySelectorAll<HTMLButtonElement>('[data-worlds-locale]').forEach(button=>button.addEventListener('click',()=>apply(button.dataset.worldsLocale as Locale,true)));
}
