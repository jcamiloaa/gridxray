/** Dollars with one decimal; amounts too small to show as $0.1 read "<$0.1" instead of "$0.0". */
export const money = (usd: number) => (usd > 0 && usd < 0.05 ? '<$0.1' : `$${usd.toFixed(1)}`)
