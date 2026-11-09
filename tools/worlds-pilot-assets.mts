import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export interface PilotAsset {path:string;sha256:string}
export interface PilotArtifact {commit:string;digest:string;assets:PilotAsset[]}
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Read the complete served artifact. Provider control files and routes handled by
 * the Worker itself are verified separately, never mistaken for static assets. */
export async function pilotArtifact(directory:string,commit:string):Promise<PilotArtifact>{
 if(!/^[0-9a-f]{40}$/.test(commit))throw new Error('Exact reviewed commit required');
 const assets:PilotAsset[]=[];
 async function walk(relative:string){
  for(const entry of await readdir(join(directory,relative),{withFileTypes:true})){
   if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in the pilot artifact');
   const path=relative?relative+'/'+entry.name:entry.name;
   if(entry.isDirectory()){await walk(path);continue;}
   if(!entry.isFile())throw new Error('Unsupported pilot artifact entry');
   if(['_headers','_redirects','.assetsignore','robots.txt','sitemap.xml'].includes(path))continue;
   if(path.split('/').some(part=>part.startsWith('.'))||/^(api|auth|ws|socket\.io|\.well-known)(\/|$)/.test(path))throw new Error('Unexpected private or dynamic artifact path');
   // The reviewed artifact has exactly one HTML document. Its canonical URL is /.
   if(path.endsWith('.html')&&path!=='index.html')throw new Error('Unexpected additional HTML artifact');
   const url=path==='index.html'?'/':'/'+path.split('/').map(encodeURIComponent).join('/');
   assets.push({path:url,sha256:sha(await readFile(join(directory,path)))});
  }
 }
 await walk('');assets.sort((a,b)=>a.path.localeCompare(b.path));
 if(assets.length<5||assets.length>100||!assets.some(a=>a.path==='/')||!assets.some(a=>a.path==='/script.js')||!assets.some(a=>a.path==='/style.css'))throw new Error('Incomplete or oversized pilot artifact');
 return {commit,digest:sha(JSON.stringify(assets)),assets};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 pilotArtifact('cloudflare/public',process.env.GITHUB_SHA??'').then(artifact=>console.log(artifact.digest)).catch(()=>{console.error('Reviewed pilot artifact could not be verified');process.exitCode=1;});
}
