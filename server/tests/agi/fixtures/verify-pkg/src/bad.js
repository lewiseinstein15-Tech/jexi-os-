// Deliberately lint-breaking file for the real eslint diagnostics test.
// Triggers no-undef (an error in the repo's real eslint config).
export function bad() {
  return definitelyUndefinedVariable;
}