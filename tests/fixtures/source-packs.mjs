// Synthetic, never-fetched source evidence for offline gate tests.
export function sourcePacks(marketId, {asOf = new Date().toISOString().slice(0, 10), checkedAt = asOf} = {}) {
  const future = new Date(Date.parse(asOf + 'T00:00:00Z') + 5 * 86400000).toISOString().slice(0, 10);
  return [{sourceFile: 'synthetic-registry.json', marketId, fixture: false,
    extra: {retained: true, unicode: 'Café', nullValue: null},
    opportunities: Array.from({length: 5}, (_, i) => ({
      id: 'synthetic-event-' + i, title: 'SYNTHETIC ONLY Event ' + i,
      eventDate: future, prepareBy: asOf, city: 'Olympia', state: 'WA',
      marketId, geographyMode: 'city_match', distanceMiles: null,
      sourceName: 'SYNTHETIC official source', sourceUrl: 'https://www.olympiawa.gov/synthetic-only-' + i,
      sourceCheckedAt: checkedAt, sourceAuthority: 'official-government', sourceAccessStatus: 'verified',
      sourceQuality: 5, customerTags: ['adults'], productTags: ['gifts'], urgency: 4,
      preparationEase: 5, offerType: 'small display', extra: {order: [2, 1]},
    })),
  }];
}
