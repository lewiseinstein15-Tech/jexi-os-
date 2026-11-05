/**
 * JEXI OS — VERIFICATION — layer names.
 *
 * The single list of verification layer names, in cheapest-first order.
 *
 * It lives in its own module so both the verify loop and the coding-turn
 * configuration can name the layers without importing each other (a cycle that
 * made the module graph fail to initialize).
 */

export const VERIFY_LAYER_ORDER = ['syntax', 'lint', 'unit', 'integration', 'build', 'agent'];
