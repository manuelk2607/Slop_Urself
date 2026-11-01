import { assessContext, POLICY, type Assessment } from './policy.js';
import { quoteAction } from './context-messages.js';
// Explicitly reviewed replacement: 2.5 Flash-Lite returns HTTP404 for this new
// project. No automatic fallback to aliases such as gemini-flash-lite-latest.
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export function geminiPayload(images: string[], prompt: string) {
    if (!images.length || images.length > 64 || images.reduce((n,image)=>n+image.length,0)>12*1024*1024) throw new Error('Invalid frame batch');
    const keys=['safe','sexual','sexualMinors','nonConsensual','graphicAbuse','uncertain'];
    return { systemInstruction: { parts: [{ text: `${POLICY}\nInspect EVERY supplied image. If any frame is unsafe or uncertain, do not approve the batch.` }] },
        contents: [{ role: 'user', parts: [{ text: `Quoted proposed action: ${quoteAction(prompt)}` }, ...images.map(data => ({ inlineData: { mimeType: 'image/png', data } }))] }],
        generationConfig: { temperature: 0, maxOutputTokens: 384, responseMimeType: 'application/json',
            responseJsonSchema: { type: 'object', properties: Object.fromEntries(keys.map(k=>[k,{type:'boolean'}])), required: keys, additionalProperties: false } }
    };
}
export function geminiVerdict(body: unknown, expectedVersion=GEMINI_MODEL): Assessment {
    if (!body || typeof body!=='object') throw new Error('gemini_schema');
    const r=body as {modelVersion?:unknown;promptFeedback?:unknown;candidates?:{finishReason?:unknown;content?:{role?:unknown;parts?:{text?:unknown;thought?:unknown}[]}}[]};
    if(r.modelVersion!==expectedVersion) throw new Error('gemini_model_drift');
    // An explicit provider safety stop is a HOLD, never a fabricated schema
    // success or an assertion that a specific risk category was identified.
    if(r.candidates?.length===1&&r.candidates[0].finishReason==='SAFETY') return {decision:'review',reason:'provider_safety_hold'};
    if(r.promptFeedback || r.candidates?.length!==1 || r.candidates[0].finishReason!=='STOP'
        || r.candidates[0].content?.role!=='model' || r.candidates[0].content.parts?.length!==1
        || r.candidates[0].content.parts[0].thought || typeof r.candidates[0].content.parts[0].text!=='string') throw new Error('gemini_incomplete');
    return assessContext(r.candidates[0].content.parts[0].text);
}
