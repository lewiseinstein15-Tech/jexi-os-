/**
 * JEXI OS — Provider bridge — cost optimizer.
 *
 * Picks the cheapest provider+model that still satisfies the capability
 * profile. Pure function over the model catalog — never names providers in
 * logic (reads price tables from the catalog).
 */

import { priceOf, modelSatisfies } from './CapabilityRouter.js';

/**
 * @param {CapabilityProfile} profile
 * @param {{providerId: string, models: object[]}[]} candidates
 * @returns {{providerId, model, price} | null}
 */
export function cheapestSatisfying(profile, candidates) {
  let best = null;
  for (const entry of candidates) {
    for (const model of entry.models || []) {
      if (!modelSatisfies(model, profile)) continue;
      const p = priceOf(model);
      if (profile.maxCostPerCall != null && p > profile.maxCostPerCall) continue;
      if (!best || p < best.price) best = { providerId: entry.providerId, model: model.id, price: p };
    }
  }
  return best;
}

/** Rank providers by total catalog price (cheapest family first). */
export function rankByPrice(entries) {
  return [...entries]
    .map((e) => ({ ...e, avgPrice: (e.models || []).reduce((s, m) => s + priceOf(m), 0) / Math.max((e.models || []).length, 1) }))
    .sort((a, b) => a.avgPrice - b.avgPrice);
}