import {de} from './de';
import {en} from './en';
export type Locale='de'|'en';
export type Message=keyof typeof de;
export const messages={de,en};
export const localeKey='worlds.locale';
export const localeCookie='__Host-worlds-locale';
export function normalizeLocale(value:string|null|undefined):Locale|undefined {
 const code=value?.trim().toLowerCase().split(/[-_]/)[0];return code==='de'||code==='en'?code:undefined;
}
export function requestLocale(request:Request):Locale {
 const explicit=normalizeLocale(new URL(request.url).searchParams.get('ui_locales'));if(explicit)return explicit;
 const saved=request.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(localeCookie+'='))?.slice(localeCookie.length+1);
 if(saved==='de'||saved==='en')return saved;
 const languages=(request.headers.get('accept-language')??'').split(',').map((part,index)=>{
  const [tag,quality]=part.trim().split(';');return {locale:normalizeLocale(tag),quality:quality?Number(quality.trim().replace(/^q=/,'')):1,index};
 }).filter(item=>item.locale&&item.quality>0&&item.quality<=1).sort((a,b)=>b.quality-a.quality||a.index-b.index);
 return languages[0]?.locale??'de';
}
export function tr(locale:Locale,key:Message):string{return `<span data-worlds-text="${key}">${messages[locale][key]}</span>`;}
