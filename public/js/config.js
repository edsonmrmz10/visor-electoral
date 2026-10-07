/* Configuración de la base cartográfica. Cambia TILE_URL por un proveedor propio
   (MapTiler, Stadia, Mapbox, un servidor propio…) si esperas tráfico alto:
   la política de tiles de OpenStreetMap no es para uso intensivo. */
window.CE_CONFIG = {
  TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_SUBDOMAINS: 'abc',
  TILE_ATTR: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  TILE_MAX_NATIVE_ZOOM: 19,
};
