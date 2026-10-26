export function ranked<T>(items: readonly T[], score: (item: T) => number) {
    let previous: number | undefined, rank = 0;
    return [...items].sort((a, b) => score(b) - score(a)).map((item, index) => {
        const value = score(item);
        if (value !== previous) rank = index + 1;
        previous = value;
        return { item, rank };
    });
}
