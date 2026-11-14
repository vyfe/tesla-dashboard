/**
 * demo 用的「假车」设定。
 *
 * 每套场景对应 meta 里的一辆车，切换车 = 切换场景。
 * 数值都是按真实特斯拉的使用习惯拍的，不是随机乱填——
 * 城市通勤能耗低、周末长途里程长、冬天续航打折，这些差异在图上要看得出来。
 */

/** 地点：名字 + WGS-84 坐标。坐标用来生成行程轨迹，底图需要 GCJ-02 时由前端换算。 */
export interface Place {
  name: string;
  lat: number;
  lng: number;
}

export interface Scenario {
  id: number;
  /** 车辆昵称，展示在左上角 */
  name: string;
  model: string;
  trim: string;
  vin: string;
  /** 标称电池容量 kWh */
  nominalKwh: number;
  /** 历史健康度：最早一次估算容量 ÷ 标称 */
  healthStart: number;
  /** 当前健康度 */
  healthNow: number;
  /** 基准能耗 kWh/100km（常温、铺装路面） */
  baseConsumption: number;
  /** 生成多少个月的历史 */
  months: number;
  /** 工作日平均行程次数 */
  drivesPerDay: number;
  /** 周末额外加的行程次数 */
  weekendExtra: number;
  /** 周末跑长途的概率（长途一天最多一次） */
  longChance: number;
  /** 快充占比 0~1 */
  fastShare: number;
  /** 电价 元/kWh */
  pricePerKwh: number;
  /** 气温区间 °C */
  tempRange: [number, number];
  /** 所在城市，出现在地址里 */
  city: string;
  /** 日常出行的地点池 */
  places: readonly Place[];
  /** 长途出行的目的地（离城市远），长途行程从「家」开到这里 */
  farPlaces: readonly Place[];
  /** 场景说明，切换器里当副标题 */
  tagline: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 1,
    name: "小红",
    model: "Model 3",
    trim: "标准续航后驱版",
    vin: "5YJ3E1EA8KF000001",
    nominalKwh: 60,
    healthStart: 0.985,
    healthNow: 0.962,
    baseConsumption: 14.2,
    months: 14,
    drivesPerDay: 2,
    weekendExtra: 1,
    longChance: 0.12,
    fastShare: 0.25,
    pricePerKwh: 1.28,
    tempRange: [8, 28],
    city: "杭州市",
    places: [
      { name: "家", lat: 30.281, lng: 120.162 },
      { name: "公司", lat: 30.183, lng: 120.245 },
      { name: "地铁站", lat: 30.264, lng: 120.186 },
      { name: "商场", lat: 30.236, lng: 120.121 },
      { name: "咖啡馆", lat: 30.295, lng: 120.139 },
      { name: "健身房", lat: 30.312, lng: 120.196 },
      { name: "超市", lat: 30.249, lng: 120.198 },
      { name: "幼儿园", lat: 30.222, lng: 120.118 },
    ],
    farPlaces: [
      { name: "莫干山民宿", lat: 30.62, lng: 119.87 },
      { name: "临安服务区", lat: 30.23, lng: 119.72 },
      { name: "千岛湖营地", lat: 29.61, lng: 119.04 },
      { name: "安吉茶园", lat: 30.64, lng: 119.68 },
    ],
    tagline: "城市通勤，每天两趟",
  },
  {
    id: 2,
    name: "大白",
    model: "Model Y",
    trim: "长续航四驱版",
    vin: "5YJ3E1EA8KF000002",
    nominalKwh: 75,
    healthStart: 0.972,
    healthNow: 0.938,
    baseConsumption: 16.8,
    months: 16,
    drivesPerDay: 1.2,
    weekendExtra: 2,
    longChance: 0.8,
    fastShare: 0.55,
    pricePerKwh: 1.52,
    tempRange: [12, 34],
    city: "杭州市",
    places: [
      { name: "家", lat: 30.281, lng: 120.162 },
      { name: "高速服务区", lat: 30.15, lng: 120.35 },
      { name: "海边服务区", lat: 30.35, lng: 121.2 },
      { name: "山顶营地", lat: 30.42, lng: 119.85 },
      { name: "海边酒店", lat: 30.36, lng: 121.15 },
      { name: "古镇停车场", lat: 30.52, lng: 120.02 },
      { name: "邻市", lat: 30.87, lng: 120.23 },
    ],
    farPlaces: [
      { name: "舟山码头", lat: 29.98, lng: 122.14 },
      { name: "台州服务区", lat: 28.66, lng: 121.42 },
      { name: "温州酒店", lat: 28.0, lng: 120.7 },
      { name: "衢州古城", lat: 28.94, lng: 118.87 },
    ],
    tagline: "周末长途，常跑高速",
  },
  {
    id: 3,
    name: "小蓝",
    model: "Model 3",
    trim: "长续航全轮驱动版",
    vin: "5YJ3E1EA8KF000003",
    nominalKwh: 75.6,
    healthStart: 0.958,
    healthNow: 0.912,
    baseConsumption: 18.4,
    months: 20,
    drivesPerDay: 1.8,
    weekendExtra: 1,
    longChance: 0.3,
    fastShare: 0.62,
    pricePerKwh: 1.68,
    tempRange: [-8, 6],
    city: "哈尔滨市",
    places: [
      { name: "家", lat: 45.803, lng: 126.534 },
      { name: "公司", lat: 45.742, lng: 126.631 },
      { name: "商场地下车库", lat: 45.769, lng: 126.596 },
      { name: "机场", lat: 45.623, lng: 126.25 },
      { name: "高速服务区", lat: 45.62, lng: 126.87 },
      { name: "温泉酒店", lat: 45.55, lng: 127.15 },
      { name: "滑雪场", lat: 45.39, lng: 128.3 },
    ],
    farPlaces: [
      { name: "亚布力雪场", lat: 46.99, lng: 126.87 },
      { name: "镜泊湖", lat: 44.09, lng: 129.15 },
      { name: "伊春服务区", lat: 47.72, lng: 128.9 },
      { name: "齐齐哈尔", lat: 47.35, lng: 123.92 },
    ],
    tagline: "北方冬天，续航打折",
  },
];

/** 场景 id → 场景，找不到就退回第一套。 */
export function findScenario(id: number | undefined): Scenario {
  return SCENARIOS.find((item) => item.id === id) ?? SCENARIOS[0];
}
