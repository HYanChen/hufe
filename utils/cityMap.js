export function cityMapView(center) {
  const latitude = center?.latitude
  const longitude = center?.longitude
  const located = center?.available === true && center?.precision === 'city' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -85 && latitude <= 85 && longitude >= -180 && longitude <= 180
  const url = `/api/v1/maps/viewer/index.html${located ? `?lon=${longitude}&lat=${latitude}` : ''}`
  return {
    located,
    embedUrl: url,
    fullUrl: url
  }
}

export function cityMapSourceUrl(center) {
  const url = String(center?.sourceUrl || '')
  return center?.source === 'GeoNames' && /^https:\/\/www\.geonames\.org\/\d+\/$/.test(url) ? url : ''
}
