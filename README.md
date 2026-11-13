# tesla-dashboard

基于 **TeslaMate** 的自定义看板：只读旁路服务，专门看**行程、电池、充电**。
不改 TeslaMate、不写库、不做车控（车控用官方 App 就好）。

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

</details>

## 架构

```
浏览器 ──HTTP Basic──► FastAPI（只读账号，事务级 read-only + 语句超时）
                            │
                            ▼
                    TeslaMate 的 PostgreSQL  ◄── TeslaMate 本体照常读写，互不打扰
```

前端 React + Tailwind + Recharts，`npm run build` 后由同一个 FastAPI 容器托管，
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
```

> `positions` 是最大的表（百万行级），只用于「行程详情」的曲线。
> 不需要曲线就把 `positions` 从授权里去掉，接口会返回空数组，页面降级为「没有轨迹采样点」。

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

## 接口一览

| 路径 | 用途 |
|---|---|
| `GET /api/health` | 连通性检查（仅 `{"ok":true}`，不泄露库名/版本） |
| `GET /api/meta` | 车辆列表、数据时间范围 |
| `GET /api/overview?car=1` | 首页聚合：KPI、30 天里程、最近行程与充电 |
| `GET /api/drives?car=1&limit=25&offset=0&date_from=2026-10-01` | 行程分页 |
| `GET /api/drives/{id}` | 单次行程的速度 / 功率 / SOC 曲线 |
| `GET /api/battery?car=1` | 容量估算、衰减趋势、SOC 分布 |
| `GET /api/charges?car=1&limit=30&offset=0` | 充电记录 + 月度汇总 |

OpenAPI 文档默认关闭，本地调试时 `ENABLE_DOCS=1` 再访问 `/api/docs`。

## 安全设计

分五层，任何一层单独失效都不至于裸奔：

| 层 | 做法 |
|---|---|
| 数据库账号 | 只有 `SELECT`，并且角色级 `default_transaction_read_only=on`，写操作直接报错 |
| 连接会话 | 每条连接强制 `default_transaction_read_only=on` + `statement_timeout`（默认 20s） |
| API | 只有固定 7 个 GET 端点，SQL 全部参数绑定，不接受任意查询 |
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
web/            React + TS + Tailwind + Recharts
sql/            本地开发的 schema 与合成数据生成器
design/         设计稿与各页面截图
```

## 已知限制

- 按 **TeslaMate v2** 的 schema 编写；更老的版本字段可能对不上（`cars.efficiency` 等），
  报错时看 `queries.py` 里的列名，改起来是单点修改；
- 只展示**第一辆车**（多车时可用 `DEFAULT_CAR_ID` 指定，切换 UI 还没做）；
- 时间戳按 UTC 存、按 `TZ_OFFSET_HOURS` 换算显示，跨时区出行（比如开车出境）不会自动切换；
- 登录只有一层 HTTP Basic，够内网看板用；要接公网请务必在反代上开 HTTPS，并按需加 IP 白名单 / VPN；
- 这个仓库的接口与页面是用合成数据验证的，还没在你真实的 TeslaMate 库上跑过——
  第一次接入如果字段对不上，把报错发我，改起来很快。

## License

MIT
