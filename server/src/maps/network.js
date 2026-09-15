import {CityCenterService} from '../regions/city-centers.js'

// Map locations are public city aggregates, never a person's coordinates.
export class AlumniMapNetwork {
  constructor(business, regions, maps) { Object.assign(this, {business, regions, maps}) }
  async locations() {
    const initial = this.business.directoryCityStats()
    const centers = new CityCenterService({directoryCityStats: () => initial}, this.regions)
    const candidates = await Promise.all(initial.items.slice(0, 500).map(async item => {
      try { return {...item, center: await centers.center(item.city)} } catch { return {...item, center: null} }
    }))
    // Visibility may change while the local coordinate catalog is being read.
    const current = this.business.directoryCityStats()
    const counts = new Map(current.items.map(item => [item.city, item.count]))
    const bounds = this.maps.publicConfig().basemap?.bounds
    const features = []
    for (const item of candidates) {
      const c = item.center, count = counts.get(item.city)
      if (!count || !c?.available || c.coordinateSystem !== 'WGS84' || c.precision !== 'city') continue
      if (!bounds || c.longitude < bounds[0] || c.longitude > bounds[2] || c.latitude < bounds[1] || c.latitude > bounds[3]) continue
      features.push({type:'Feature',properties:{city:item.city,count,precision:'city',source:c.source,sourceUrl:c.sourceUrl},geometry:{type:'Point',coordinates:[c.longitude,c.latitude]}})
    }
    return {type:'FeatureCollection',features,revision:current.revision,precision:'city',displayedProfiles:features.reduce((sum, f) => sum + f.properties.count, 0),unmappedCities:Math.max(0,current.items.length-features.length)}
  }
}
