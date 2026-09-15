// Structured clone cannot send Vue reactive proxies across the iframe boundary.
// GeoJSON is JSON data: detach it, including nested reactive properties, first.
export function mapEditorMessage(geojson) {
  return {type:'hufe-map-load',geojson:JSON.parse(JSON.stringify(geojson))}
}
