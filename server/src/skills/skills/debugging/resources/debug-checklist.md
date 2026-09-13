# Debugging checklist

- Isolate the first failing assertion only.
- Read the code path that produced the actual value.
- Check for shared mutable state across tests.
- Verify the test asserts the intended invariant, not an accident.
- Re-run the single test before the full suite.