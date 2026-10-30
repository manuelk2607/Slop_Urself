// JSON escaping retains the exact proposed action as data. Literal model/chat
// delimiters must not become additional turns or image placeholders in a template.
export function quoteAction(prompt: string) {
    return JSON.stringify(prompt).replace(/[<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function contextMessages(policy: string, prompt: string, separateSystem = false) {
    const action = `Quoted proposed action: ${quoteAction(prompt)}`;
    const user = { role: 'user', content: [{ type: 'image' }, { type: 'text', text: separateSystem ? action : `${policy}\n${action}` }] };
    return separateSystem ? [{ role: 'system', content: [{ type: 'text', text: policy }] }, user] : [user];
}
