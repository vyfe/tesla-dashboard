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
浏览器 ──► FastAPI（只读账号，事务级 read-only + 语句超时）
                │
                ▼
        TeslaMate 的 PostgreSQL  ◄── TeslaMate 本体照常读写，互不打扰
```

前端 React + Tailwind + Recharts，`npm run build` 后由同一个 FastAPI 容器托管，
生产环境只有一个容器、一个端口。

## 快速开始

### 1. 在 TeslaMate 的库里建只读账号

```sql
CREATE ROLE tesla_readonly LOGIN PASSWORD '换成强密码';

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
vim .env          # 改 DATABASE_URL 和 NOMINAL_KWH
```

最关键的三个值：

| 变量 | 说明 | 示例 |
|---|---|---|
| `DATABASE_URL` | 只读连接串 | `postgresql://tesla_readonly:pwd@database:5432/teslamate` |
| `NOMINAL_KWH` | 车辆标称容量，算健康度用 | Model 3 长续航 `75.6` |
| `TZ_OFFSET_HOURS` | 本地时区偏移，用于按天/月切分 | 东八区 `8` |

### 3. 启动

```bash
docker compose up -d --build
docker compose logs -f dashboard
```

打开 `http://<服务器IP>:4001`。

## 接进现有的 TeslaMate compose

如果 TeslaMate 已经跑在 compose 里，把这段加到**同一个** `docker-compose.yml`：

```yaml
  dashboard:
    build: ./tesla-dashboard
    restart: unless-stopped
    env_file: ./tesla-dashboard/.env
    ports:
      - "4001:8000"
```

同一个 compose 项目会自动共享网络，`DATABASE_URL` 里直接写数据库服务名（通常是 `database`）。

跨 compose 项目则要显式挂网络：

```yaml
    networks: [teslamate_default]

networks:
  teslamate_default:
    external: true
```

## 接口一览

| 路径 | 用途 |
|---|---|
| `GET /api/health` | 连通性检查（含数据库版本） |
| `GET /api/meta` | 车辆列表、数据时间范围 |
| `GET /api/overview?car=1` | 首页聚合：KPI、30 天里程、最近行程与充电 |
| `GET /api/drives?car=1&limit=25&offset=0&date_from=2026-10-01` | 行程分页 |
| `GET /api/drives/{id}` | 单次行程的速度 / 功率 / SOC 曲线 |
| `GET /api/battery?car=1` | 容量估算、衰减趋势、SOC 分布 |
| `GET /api/charges?car=1&limit=30&offset=0` | 充电记录 + 月度汇总 |

FastAPI 自带文档：`http://<IP>:4001/api/docs`。

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
  ./.venv/bin/uvicorn api.main:app --reload --port 8000

# 4. 前端（:5173，已配好 proxy）
cd web && npm install && npm run dev
```

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
- 前端没有做权限，**不要直接暴露到公网**，放内网或套一层 Basic Auth / VPN；
- 这个仓库的接口与页面是用合成数据验证的，还没在你真实的 TeslaMate 库上跑过——
  第一次接入如果字段对不上，把报错发我，改起来很快。

## License

MIT
