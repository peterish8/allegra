/** Fisher–Yates: a new, uniformly shuffled array. The input is not changed. */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const pick = Math.min(index, Math.floor(rand() * (index + 1)));
    const held = result[index] as T;
    result[index] = result[pick] as T;
    result[pick] = held;
  }
  return result;
}
