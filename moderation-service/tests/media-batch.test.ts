import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {inspectVideo} from '../src/media.js';
test('bounded concurrent batches inspect every unique native frame, propagate risk and never approve partial work',async()=>{
    const root=await mkdtemp(join(tmpdir(),'moderation-batch-'));
    try{
        const path=join(root,'safe.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=16:d=5.0625','-frames:v','81','-c:v','libx264','-pix_fmt','yuv420p',path]);
        const video=(await readFile(path)).toString('base64');let inFlight=0,max=0,batches=0;
        const seen=new Set<string>();
        const r=await inspectVideo(video,async()=>{throw new Error('Must use batch protocol');},undefined,async frames=>{
            assert.ok(frames.length>=1&&frames.length<=8);inFlight++;max=Math.max(max,inFlight);const index=batches++;
            for(const frame of frames){const hash=createHash('sha256').update(frame).digest('hex');assert.equal(seen.has(hash),false);seen.add(hash);}
            await new Promise(resolve=>setTimeout(resolve,5));inFlight--;return index===4?'block':'allow';});
        assert.equal(r.decision,'block');assert.equal(r.frameCount,81);assert.equal(r.framesChecked,81);assert.equal(r.uniqueFramesChecked,seen.size);
        assert.ok(seen.size>=80);assert.ok(max<=2);assert.equal(inFlight,0);
        let calls=0;
        await assert.rejects(inspectVideo(video,async()=> 'allow',undefined,async()=>{calls++;throw new Error('provider unavailable');}),/provider unavailable/);
        assert.ok(calls<=2);
        const abort=new AbortController();await assert.rejects(inspectVideo(video,async()=> 'allow',abort.signal,async()=>{abort.abort();return 'allow';}));
    }finally{await rm(root,{recursive:true,force:true});}
});
