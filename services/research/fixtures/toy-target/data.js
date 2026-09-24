// Toy data — the analog of autoresearch's prepared dataset (prepare.py side).
// Deterministic: fixed seed, so every experiment run evaluates identically.
// Latent function: y = 0.7x + 0.2 + uniform noise.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateData({ seed = 42, trainN = 64, valN = 32, noise = 0.02 } = {}) {
  const rand = mulberry32(seed);
  const point = () => {
    const x = rand();
    const y = 0.7 * x + 0.2 + (rand() * 2 - 1) * noise;
    return { x, y };
  };
  return {
    train: Array.from({ length: trainN }, point),
    val: Array.from({ length: valN }, point),
  };
}
