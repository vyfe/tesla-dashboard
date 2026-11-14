# tesla-dashboard

基于 **TeslaMate** 的自定义看板：只读旁路服务，专门看**行程、电池、充电**。
不改 TeslaMate、不写库、不做车控（车控用官方 App 就好）。
界面支持浅色 / 深色跟随系统，也可以手动切换。

![总览](design/shot-overview.png)

<details>
<summary>其余页面截图</summary>

**行程明细 + 单次曲线**

![行程](design/shot-drives.png)
![行程详情](design/shot-drive-modal.png)

**电池健康**

![电池](design/shot-battery.png)

**充电记录**

![充电](design/shot-charging.png)

**浅色模式**

![浅色总览](design/shot-overview-light.png)

</details>

## 架构

```
浏览器 ──HTTP Basic──► FastAPI（只读账号，事务级 read-only + 语句超时）
                            │
                            ▼
                    TeslaMate 的 PostgreSQL  ◄── TeslaMate 本体照常读写，互不打扰
```

前端 React + Tailwind + Recharts + Leaflet，`npm run build` 后由同一个 FastAPI 容器托管，
生产环境只有一个容器、一个端口。浏览器只跟 `/api/*` 打交道，**没有任何前端直连数据库的路径**，
连接串只存在于服务端环境变量里。

## 快速开始

### 1. 在 TeslaMate 的库里建只读账号

```sql
CREATE ROLE tesla_readonly LOGIN PASSWORD '换成强密码';

-- 双保险：就算连接串泄漏，这个角色也写不进去、也改不了会话
ALTER ROLE tesla_readonly SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE teslamate TO tesla_readonly;
GRANT USAGE  ON SCHEMA public TO tesla_readonly;
GRANT SELECT ON cars, drives, charging_processes, positions, addresses, geofences
             TO tesla_readonly;

-- 近 7 天状态时间线需要；老版本没有这张表就跳过，页面会自动降级
GRANT SELECT ON states TO tesla_readonly;
```

> `positions` 是最大的表（百万行级），用于「行程详情」曲线和顶部状态条。
> 不需要这些就把 `positions` 从授权里去掉，接口会返回空数组，页面降级为「没有轨迹采样点」。
> 状态条按 `car_id + date` 取最新一条，生产库确认有对应索引，没有会很慢：
> `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_car_date ON positions (car_id, date DESC);`

### 2. 配置

```bash
cp .env.example .env
vim .env          # 改 DATABASE_URL、DASHBOARD_USER/PASSWORD、NOMINAL_KWH
```

最关键的几个值：

| 变量 | 说明 | 示例 |
|---|---|---|
| `DATABASE_URL` | 只读连接串 | `postgresql://tesla_readonly:pwd@database:5432/teslamate` |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | 看板登录账号，两个都填才生效；**生产必填** | `tesla` / 强密码 |
| `NOMINAL_KWH` | 车辆标称容量，算健康度用 | Model 3 长续航 `75.6` |
| `TZ_OFFSET_HOURS` | 本地时区偏移，用于按天/月切分 | 东八区 `8` |
| `DASHBOARD_BIND` | 宿主监听地址，默认只绑 `127.0.0.1` | 局域网直连才改 `0.0.0.0` |
| `ENABLE_DOCS` | 是否开放 `/api/docs`，默认关 | 仅本地调试置 `1` |

### 3. 启动

```bash
docker compose up -d --build
docker compose logs -f dashboard
```

访问 `http://127.0.0.1:4001`（或你反代出去的域名），首次会弹浏览器原生登录框。

> 默认只绑 `127.0.0.1`，从本机连服务器用 SSH 隧道：
> `ssh -L 4001:127.0.0.1:4001 用户名@服务器`。
> 局域网直连需在 `.env` 设 `DASHBOARD_BIND=0.0.0.0`，并确保已配登录密码。

## 打包上传

```bash
./scripts/package.sh             # 源码包，输出到 release/
./scripts/package.sh --with-dist # 连前端构建产物一起打包（服务器上可跳过 npm）
./scripts/package.sh --verify    # 打包前跑一遍后端单元测试
```

脚本打包的是**当前工作区**（包含未提交改动），默认排除 `.env`、`node_modules`、`.venv`、`.pgdata`、`.chrome-profile`、`web/dist`。
产物名带时间戳和 commit，有未提交改动时加 `-dirty`，同时生成 `.sha256`。

上传并解压：

```bash
scp release/tesla-dashboard-*.tar.gz 用户@服务器:/opt/teslamate/
ssh 用户@服务器 'cd /opt/teslamate && tar -xzf tesla-dashboard-*.tar.gz'
```

> 包里的根目录是 `tesla-dashboard/`，解压会原地覆盖同名文件；`.env` 不在包里，不会被覆盖。
> 解压后照样执行 `docker compose up -d --build dashboard`。

## 接进现有的 TeslaMate compose

假设 TeslaMate 已经跑在 `/opt/teslamate/docker-compose.yml`，按下面四步接：

**1. 放代码、配环境**

```bash
cd /opt/teslamate
git clone <本仓库地址> tesla-dashboard
cd tesla-dashboard
cp .env.example .env
vim .env      # 填 DASHBOARD_USER/PASSWORD、NOMINAL_KWH；DATABASE_URL 用 database 作主机名
```

**2. 在同一个 `docker-compose.yml` 里加服务**

```yaml
  dashboard:
    build: ./tesla-dashboard
    image: tesla-dashboard:local
    container_name: tesla-dashboard
    restart: unless-stopped
    env_file: ./tesla-dashboard/.env
    ports:
      - "127.0.0.1:4001:8000"   # 只给本机；要局域网直连改成 "0.0.0.0:4001:8000"
    depends_on:
      - database
    security_opt:
      - no-new-privileges:true
```

同一个 compose 项目会自动共享网络，`DATABASE_URL` 里直接写数据库服务名（通常是 `database`），
不需要 `networks:` 配置。

**3. 建只读账号**（只需一次）

```bash
docker compose exec database psql -U teslamate -d teslamate
# 粘贴前面「快速开始 1」里的 CREATE ROLE / GRANT 语句
```

**4. 构建并启动，看日志**

```bash
docker compose up -d --build dashboard
docker compose logs -f dashboard
curl -u tesla:你的密码 http://127.0.0.1:4001/api/health
# {"ok":true}
```

跨 compose 项目才需要显式挂外部网络：

```yaml
    networks: [teslamate_default]

networks:
  teslamate_default:
    external: true
    name: teslamate_default
```

## 界面

- **顶部状态条**：最近一次上报的电量、剩余续航、总里程，每 60 秒刷新一次。数据来自 TeslaMate 的 `positions`，不直连特斯拉 API，所以会如实标注「x 分钟前」。
- **本月能量账本**：充入 / 电费 / 充电效率 / 行驶耗电放在一起，充电损耗按 `充入 ÷ 电网取用` 算。
- **里程日历**：近 5 周热力格，配「有行程天数 / 单日最多」。
- **行程轨迹地图**：行程详情弹窗顶部是一张 Leaflet 地图，轨迹按速度分色（蓝→青→绿→黄→橙→红），点地图任意位置会弹出该时刻的速度 / 功率 / 电量 / 海拔。右上角可切换底图：高德路网 / 高德卫星 / 高德影像路网。
- **近 7 天状态**：行驶（蓝）、充电（琥珀）、在线（灰）时间带；没授权 `states` 时只显示前两者。
- **停留地点**：时间轴上每段停留标成一枚标签（地点名 + 时长），**鼠标悬停直接弹出小地图**标出它在哪儿；充电页和总览的充电记录同样悬停出图。地点名优先取 TeslaMate 的围栏名（"家"、"公司-京东总部"），围栏没罩住时退回逆地理编码的地址。
- **主题**：默认跟随系统，右上角按钮循环「自动 → 浅色 → 深色」，选择存在 localStorage；也可以用 `?theme=light` / `?theme=dark` 强制。

### 停留是怎么算出来的

TeslaMate 的 `states` 表只有 `online` / `offline`，拿不到「停在哪、停了多久」；
但 `drives` 给了每段行程的起止时间，**两次行程之间的空档就是车停着的那段时间**。
所以停留 = 上一段行程结束 → 下一段行程开始（含末尾那次行程之后到现在），
坐标取行程结束时刻附近的采样点（`positions`）。短于 15 分钟的不算，等红灯而已。

> 不用「连续零速采样点」判断：停车时 GPS 速度会飘（3~10 km/h），
> 零速点会被噪声切碎，实测同一段停车会被切成十几段，识别率极差。

### 轨迹地图的坐标系

TeslaMate 的 `positions` 存的是 **WGS-84** 原始坐标，而高德底图用的是 **GCJ-02**，
两者在北京一带差 500 米左右，直接叠加轨迹会整体偏出道路。
`web/src/lib/gcj02.ts` 用国测局公开算法在浏览器本地换算（不依赖高德的 convert 服务，离线也能用），
并且**只对 GCJ-02 底图生效**：`DriveMap.tsx` 里每个底图都带 `gcj02` 标记，
高德三层为 `true`，换成 WGS-84 底图时用原始坐标。
实测偏移量：北京 538 m、上海 481 m、境外坐标不偏移。

> OpenStreetMap 和 CARTO 暗色底图曾作为可切换项，因国内访问不稳定已下线；
> 需要时把条目加回 `BASEMAPS` 即可，坐标偏移逻辑无需改动。

## 接口一览

| 路径 | 用途 |
|---|---|
| `GET /api/health` | 连通性检查（仅 `{"ok":true}`，不泄露库名/版本） |
| `GET /api/meta` | 车辆列表、数据时间范围 |
| `GET /api/status?car=1` | 车辆最近一次上报：SOC、续航、总里程、是否在充电 |
| `GET /api/timeline?car=1&days=7` | 近 N 天行驶 / 充电 / 在线状态区间 |
| `GET /api/overview?car=1` | 首页聚合：能量账本、45 天里程、最近行程与充电 |
| `GET /api/drives?car=1&limit=25&offset=0&date_from=2026-10-01` | 行程分页 |
| `GET /api/drives/{id}` | 单次行程的速度 / 功率 / SOC 曲线 + 轨迹经纬度 |
| `GET /api/battery?car=1` | 容量估算、衰减趋势、SOC 分布 |
| `GET /api/charges?car=1&limit=30&offset=0` | 充电记录 + 月度汇总 |

OpenAPI 文档默认关闭，本地调试时 `ENABLE_DOCS=1` 再访问 `/api/docs`。

## 对外分享：demo 入口

`/demo` 是一个**不需要登录**的对外入口：只有界面，数据全是程序生成的假数据，
用来给别人看样式、演示功能，不会碰到任何真实车辆信息。

```bash
cd web && npm run build:demo      # 产出 web/dist-demo（构建期开关，不进生产包）
# .env 里打开
echo 'DEMO_ENABLED=1' >> .env
docker compose up -d --build
# 访问 http://<你的域名>/demo
```

要点：

- **默认关闭**。`DEMO_ENABLED=0`（默认）时 `/demo` 跟主站一样要登录，登录后返回 404「demo 未启用」；
  没配鉴权时直接 404。必须显式打开。
- **只豁免 `/demo` 前缀**。`/api/*` 永远要鉴权——demo 页面里不存在任何能读到真实数据的路径。
- **mock 数据在构建期注入**。`VITE_DEMO=1` 时前端的数据源换成 `web/src/mock/`，一个网络请求都不发；
  生产构建不设这个变量，整棵 mock 依赖会被 tree-shaking 掉，产物里不留任何假数据代码。
- **只有样式，数据自洽**。三套可切换的场景（城市通勤 / 周末长途 / 北方冬天），
  里程由起终点的地理距离反推，所以地图轨迹长度和列表里的里程永远对得上；
  电量按天仿真，充入量与行驶耗电能在能量账本上对上。
- **顶部有「示例数据」标识**，截图外传时不会被人当成真实数据。

场景定义在 `web/src/mock/scenarios.ts`，数据生成在 `web/src/mock/generator.ts`。

## 安全设计

分五层，任何一层单独失效都不至于裸奔：

| 层 | 做法 |
|---|---|
| 数据库账号 | 只有 `SELECT`，并且角色级 `default_transaction_read_only=on`，写操作直接报错 |
| 连接会话 | 每条连接强制 `default_transaction_read_only=on` + `statement_timeout`（默认 20s） |
| API | 只有固定 9 个 GET 端点，SQL 全部参数绑定，不接受任意查询 |
| 入口 | HTTP Basic 登录（`DASHBOARD_USER` / `DASHBOARD_PASSWORD`），常量时间比较；健康检查是唯一免登录路径，且只回 `{"ok":true}` |
| 网络 | 容器默认只绑 `127.0.0.1`；生产 docs/openapi 关闭；SPA 静态文件做了目录逃逸校验；带 `nosniff` / `DENY` / `no-referrer` 等安全头 |

**还差一步：TLS。** Basic 密码是明文传输，对外必须在反向代理上终结 HTTPS：

```caddy
# Caddy：自动签发证书
dashboard.example.com {
    reverse_proxy 127.0.0.1:4001
}
```

```nginx
# Nginx
server {
    listen 443 ssl http2;
    server_name dashboard.example.com;
    # ssl_certificate ...;
    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

自检（部署后跑一遍）：

```bash
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4001/api/overview        # 401
curl -u 用户:密码 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4001/api/docs # 404
curl -u 用户:密码 --path-as-is "http://127.0.0.1:4001/..%2f..%2fapi%2fdb.py"      # 200 但返回 index.html
```

## 数据口径（重要）

TeslaMate **不存电池容量**，所以健康度是估算值，页面上也标注了「估算」：

- **容量**：`charge_energy_added / (end_soc − start_soc) × 100`，
  只取 SOC 跨度 ≥ 15%、时长 ≥ 10 分钟的充电段，落在 30–120 kWh 之外的一律丢弃；
- **满电续航**：`end_rated_range_km / end_soc × 100`，只取结束 SOC ≥ 50% 的记录；
- **对外只给滚动中位数**（按月中位数），不暴露单点，避免一次快充就"掉 3%"的误判；
- 直流快充发热会让充入电量偏大，估算值略高——这是方法本身的噪声，不是 bug。

## 本地开发

不需要真车，也不需要 TeslaMate：

```bash
# 1. 起一个本地 Postgres（示例端口 55432）
initdb -D .pgdata -U postgres --auth=trust
pg_ctl -D .pgdata -o "-p 55432 -k /tmp" start
createdb -h 127.0.0.1 -p 55432 -U postgres teslamate

# 2. 建表 + 灌 18 个月的合成数据
psql -h 127.0.0.1 -p 55432 -U postgres -d teslamate -f sql/schema.sql
python3 -m venv .venv && ./.venv/bin/pip install -r api/requirements.txt
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/teslamate ./.venv/bin/python sql/seed.py

# 3. 后端（:8000）
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/teslamate NOMINAL_KWH=75.6 \
ENABLE_DOCS=1 ./.venv/bin/uvicorn api.main:app --reload --port 8000

# 4. 前端（:5173，已配好 proxy）
cd web && npm install && npm run dev

# 5. 单元测试
./.venv/bin/python -m unittest discover -s tests -t .
```

本地开发不需要配 `DASHBOARD_USER` / `DASHBOARD_PASSWORD`（留空即关闭鉴权），
但接口会监听 `127.0.0.1`，不会暴露到局域网。

`sql/schema.sql` 是 TeslaMate schema 的子集，列名对齐
`elixir/lib/teslamate/log/*.ex`，只用于本地开发，生产环境不要执行。

## 目录

```
api/            FastAPI：db.py 连接池 / queries.py 全部 SQL / analytics.py 电池估算
web/            React + TS + Tailwind + Recharts + Leaflet
web/src/mock/   demo 用的假数据：scenarios.ts 场景 / generator.ts 生成器
sql/            本地开发的 schema 与合成数据生成器
design/         设计稿与各页面截图
scripts/        package.sh 打包脚本
```

## 已知限制

- 按 **TeslaMate v2** 的 schema 编写；更老的版本字段可能对不上（`cars.efficiency` 等），
  报错时看 `queries.py` 里的列名，改起来是单点修改；
- 只展示**第一辆车**（多车时可用 `DEFAULT_CAR_ID` 指定，切换 UI 还没做；demo 模式下可以切场景）；
- `/demo` 入口默认关闭，且**只提供静态产物**——它不读数据库，因此也不会跟着真实数据更新；
- 时间戳按 UTC 存、按 `TZ_OFFSET_HOURS` 换算显示，跨时区出行（比如开车出境）不会自动切换；
- 状态条是「TeslaMate 最后上报」而不是实时：延迟取决于 TeslaMate 的轮询间隔。直连特斯拉 Fleet API 需要 OAuth、刷新令牌和唤醒车辆，会打破只读旁路的定位，不建议塞进这个服务；
- 近 7 天状态带需要 `states` 表授权；没有时只显示行驶和充电，页面会给出提示；
- 登录只有一层 HTTP Basic，够内网看板用；要接公网请务必在反代上开 HTTPS，并按需加 IP 白名单 / VPN；
- 这个仓库的接口与页面是用合成数据验证的，还没在你真实的 TeslaMate 库上跑过——
  第一次接入如果字段对不上，把报错发我，改起来很快。

## License

MIT
