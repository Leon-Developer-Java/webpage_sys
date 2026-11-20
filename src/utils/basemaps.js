// Application map configuration shared by the 2D wrapper and Scene3D.
export const BASEMAPS = {
  '矢量底图': { url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', coordinates: 'GCJ02', credit: '高德地图' },
  '影像底图': { url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', coordinates: 'GCJ02', credit: '高德地图' },
  '地形晕渲': { url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', coordinates: 'WGS84', credit: 'OpenTopoMap' },
  '全球境界': { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', coordinates: 'WGS84', credit: 'Esri' },
};
