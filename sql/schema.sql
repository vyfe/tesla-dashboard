-- TeslaMate 数据模型的一个子集，仅用于本地开发与验证。
-- 列名与 TeslaMate 实际 schema 对齐（elixir/lib/teslamate/log/*.ex）。
-- 生产环境不需要执行这个文件——你连的是 TeslaMate 自己的库。

CREATE TABLE IF NOT EXISTS cars (
    id               bigserial PRIMARY KEY,
    eid              bigint,
    vid              bigint,
    vin              text,
    name             text,
    model            text,
    efficiency       double precision,
    trim_badging     text,
    marketing_name   text,
    exterior_color   text,
    wheel_type       text,
    spoiler_type     text,
    display_priority integer,
    inserted_at      timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
    id             bigserial PRIMARY KEY,
    display_name   text,
    name           text,
    house_number   text,
    road           text,
    neighbourhood  text,
    city           text,
    county         text,
    state          text,
    state_district text,
    postcode       text,
    country        text,
    latitude       numeric,
    longitude      numeric,
    osm_id         bigint,
    osm_type       text,
    raw            jsonb,
    inserted_at    timestamp,
    updated_at     timestamp
);

CREATE TABLE IF NOT EXISTS geofences (
    id          bigserial PRIMARY KEY,
    name        text,
    latitude    numeric,
    longitude   numeric,
    radius      integer,
    inserted_at timestamp,
    updated_at  timestamp
);

CREATE TABLE IF NOT EXISTS positions (
    id                    bigserial PRIMARY KEY,
    car_id                bigint REFERENCES cars (id),
    drive_id              bigint,
    date                  timestamp NOT NULL,
    latitude              numeric,
    longitude             numeric,
    elevation             integer,
    speed                 integer,
    power                 integer,
    odometer              double precision,
    ideal_battery_range_km numeric,
    est_battery_range_km  numeric,
    rated_battery_range_km numeric,
    battery_level         integer,
    usable_battery_level  integer,
    battery_heater        boolean,
    battery_heater_on     boolean,
    battery_heater_no_power boolean,
    outside_temp          numeric,
    inside_temp           numeric,
    fan_status            integer,
    driver_temp_setting   numeric,
    passenger_temp_setting numeric,
    is_climate_on         boolean,
    is_rear_defroster_on  boolean,
    is_front_defroster_on boolean,
    tpms_pressure_fl      numeric,
    tpms_pressure_fr      numeric,
    tpms_pressure_rl      numeric,
    tpms_pressure_rr      numeric
);

CREATE TABLE IF NOT EXISTS drives (
    id                  bigserial PRIMARY KEY,
    car_id              bigint REFERENCES cars (id),
    start_date          timestamp,
    end_date            timestamp,
    start_km            double precision,
    end_km              double precision,
    distance            double precision,
    duration_min        integer,
    outside_temp_avg    numeric,
    inside_temp_avg     numeric,
    speed_max           integer,
    power_max           integer,
    power_min           integer,
    start_ideal_range_km numeric,
    end_ideal_range_km  numeric,
    start_rated_range_km numeric,
    end_rated_range_km  numeric,
    ascent              integer,
    descent             integer,
    start_position_id   bigint,
    end_position_id     bigint,
    start_address_id    bigint,
    end_address_id      bigint,
    start_geofence_id   bigint,
    end_geofence_id     bigint
);

CREATE TABLE IF NOT EXISTS charging_processes (
    id                    bigserial PRIMARY KEY,
    car_id                bigint REFERENCES cars (id),
    position_id           bigint,
    address_id            bigint,
    geofence_id           bigint,
    start_date            timestamp,
    end_date              timestamp,
    charge_energy_added   numeric,
    charge_energy_used    numeric,
    start_battery_level   integer,
    end_battery_level     integer,
    duration_min          integer,
    start_ideal_range_km  numeric,
    end_ideal_range_km    numeric,
    start_rated_range_km  numeric,
    end_rated_range_km    numeric,
    outside_temp_avg      numeric,
    cost                  numeric
);

CREATE TABLE IF NOT EXISTS states (
    id         bigserial PRIMARY KEY,
    car_id     bigint REFERENCES cars (id),
    state      text,
    start_date timestamp,
    end_date   timestamp
);

CREATE INDEX IF NOT EXISTS idx_positions_drive ON positions (drive_id);
CREATE INDEX IF NOT EXISTS idx_drives_car_date ON drives (car_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_cp_car_date ON charging_processes (car_id, start_date DESC);
