import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
// Whitelist only. No environment, credentials, weights, tests, caches or private
// reports can enter a deployment package through directory/glob traversal.
const files={ 'app.py':'app.py','official.py':'official.py','jobs.py':'jobs.py','producer.py':'producer.py',
    'prepare_official.py':'prepare_official.py','official-model-lock.json':'official-model-lock.json',
    'requirements-space.txt':'pre-requirements.txt','requirements-space-bootstrap.txt':'requirements.txt','SPACE-README.md':'README.md' };
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const output=resolve('.local',`wan-producer-package-${sourceCommit.slice(0,8)}-${randomUUID()}`);await mkdir(output,{mode:0o700});
const hashes:Record<string,string>={};
for(const [source,target] of Object.entries(files)){
    const bytes=await readFile(resolve('wan-service',source));
    if(target==='pre-requirements.txt'&&(!bytes.includes(Buffer.from('--hash=sha256:'))||bytes.includes(Buffer.from('git+'))))throw new Error('Frozen pre-install package hashes required');
    if(target==='requirements.txt'){
        const locked=(await readFile('wan-service/requirements-space.txt','utf8')).split('\n')
            .filter(line=>/^[a-z][a-z0-9_.-]*(?:\[[a-z, ]+\])?==[^\s]+/.test(line))
            .map(line=>line.replace(/\s*\\$/,'').replaceAll(', ',','));
        const bootstrap=bytes.toString().split('\n').filter(line=>line&&!line.startsWith('#'));
        if(JSON.stringify(locked)!==JSON.stringify(bootstrap))throw new Error('Platform bootstrap must contain exactly the hash-preinstalled pins');
    }
    await writeFile(resolve(output,target),bytes,{flag:'wx',mode:0o600});hashes[target]=createHash('sha256').update(bytes).digest('hex');
}
await writeFile(resolve(output,'DEPLOYMENT.json'),JSON.stringify({sourceCommit,files:hashes,qualified:false,defaultModelLoading:false,gpuCalls:0,
    scope:'CPU/unready deployment only. Model loading and live GPU jobs need separate acceptance.'},null,2)+'\n',{flag:'wx',mode:0o600});
console.info(JSON.stringify({packageDirectory:output,files:Object.keys(files).length,sourceCommit,qualified:false,modelLoading:false}));
