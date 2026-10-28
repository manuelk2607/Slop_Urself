import { Tensor } from '@huggingface/transformers';

export function snapshotInput(value: unknown) {
    if (!(value instanceof Tensor) || value.type !== 'int64' || value.dims.length !== 2 || value.dims[0] !== 1 || value.dims[1] < 1) throw new Error('Unexpected context input');
    return Array.from(value.data);
}
export function newContextTokens(value: unknown, input: ReturnType<typeof snapshotInput>, limit: number) {
    if (!(value instanceof Tensor) || value.type !== 'int64' || value.dims.length !== 2 || value.dims[0] !== 1
        || value.dims[1] <= input.length || value.dims[1] - input.length > limit
        || input.some((token, i) => value.data[i] !== token)) throw new Error('Unexpected context output prefix or length');
    return value.slice(null, [input.length, value.dims[1]]);
}
export function responseShape(value: string) {
    const text = value.trim();
    if (!text) return 'empty';
    if (/^(ALLOW|BLOCK|REVIEW)$/i.test(text)) return 'label';
    if (/^(?:"(?:ALLOW|BLOCK|REVIEW)"|'(?:ALLOW|BLOCK|REVIEW)'|(?:ALLOW|BLOCK|REVIEW)[.!])$/i.test(text)) return 'decorated_label';
    if (text.startsWith('```')) return 'fenced';
    if (text.startsWith('{') && text.endsWith('}')) return 'object';
    return 'other';
}
