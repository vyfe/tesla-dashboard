// WGS-84 → GCJ-02 坐标偏移。
//
// TeslaMate 的 positions 表存的是 GPS 原始坐标（WGS-84），而高德底图用的是
// GCJ-02（火星坐标），两者在北京一带相差几百米，直接叠加会让轨迹整体偏出
// 道路。这里用国测局公开算法在本地换算，不依赖高德的 convert 服务，
// 因此离线也能用；OSM 这类 WGS-84 底图则必须用原始坐标，不能换算。

const PI = Math.PI;
const A = 6378245.0; // 克拉索夫斯基椭球长半轴（米）
const EE = 0.00669342162296594323; // 偏心率平方

/** 粗略判断是否在中国境外；境外不��加偏移。 */
function outOfChina(lng: number, lat: number): boolean {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * 把 WGS-84 坐标换算成 GCJ-02。
 * @param lng 经度（WGS-84）
 * @param lat 纬度（WGS-84）
 * @returns [经度, 纬度]（GCJ-02）；境外坐标原样返回
 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/** 判断两点直线距离（米），用于剔除重复采样点。 */
export function haversine(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const R = 6371008.8;
  const toRad = (deg: number) => (deg * PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
