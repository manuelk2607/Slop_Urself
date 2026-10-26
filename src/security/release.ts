export function releaseId(value: unknown) {
    // Only deployment identifiers, never arbitrary tags or environment strings.
    return typeof value === 'string' && (/^[a-f0-9]{40}$/i.test(value) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) ? value : undefined;
}
