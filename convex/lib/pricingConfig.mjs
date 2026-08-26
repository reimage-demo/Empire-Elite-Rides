export function mergePricingSnapshot(defaults, snapshot) {
  return { ...defaults, ...(snapshot || {}) }
}
