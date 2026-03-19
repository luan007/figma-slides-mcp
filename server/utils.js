// Hex string to Figma SOLID paint
export function expandFills(fills) {
  if (!fills) return undefined;
  if (typeof fills === 'string') fills = [fills];
  if (!Array.isArray(fills)) return fills;
  return fills.map(f => {
    if (typeof f === 'string' && f.startsWith('#')) {
      const hex = f.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return { type: 'SOLID', color: { r, g, b }, opacity: 1 };
    }
    return f;
  });
}

// Resolve $N.field references in batch params
export function resolveBatchRefs(params, results) {
  const json = JSON.stringify(params);
  const resolved = json.replace(/"\$(\d+)\.(\w+)"/g, (match, idx, field) => {
    const i = parseInt(idx);
    if (i >= results.length || results[i].error) {
      throw new Error(`Reference $${i} failed or not yet available`);
    }
    return JSON.stringify(results[i].result[field]);
  });
  return JSON.parse(resolved);
}
