// Toy candidate — the analog of train.py: the ONLY file the experiment loop edits.
// Starting point: a mediocre linear guess. Latent target is 0.7x + 0.2 (+ noise),
// so a good experiment moves toward that. Metric: val_metric (lower is better).
export function predict(x) {
  return 0.5 * x + 0.5;
}
