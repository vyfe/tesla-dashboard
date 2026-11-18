"""只读数据库访问层。

刻意做成只读：连接串建议用只有 SELECT 权限的账号，这里再叠一层
"事务只读 + 语句超时"，避免误操作和慢查询把 TeslaMate 拖死。
"""

from __future__ import annotations

import os
from typing import Any, Sequence

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://teslamate:password@localhost:5432/teslamate"
)
# 写连接串：只给「改显示偏好」这类操作用。没有它，看板就是纯只读的。
# 账号本身要在数据库侧被限制到只有 settings 表的写权限。
SETTINGS_DATABASE_URL = os.environ.get("SETTINGS_DATABASE_URL", "")
STATEMENT_TIMEOUT_MS = int(os.environ.get("STATEMENT_TIMEOUT_MS", "20000"))
POOL_SIZE = int(os.environ.get("POOL_SIZE", "4"))

_pool: ConnectionPool | None = None
_writer_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=POOL_SIZE,
            kwargs={
                "row_factory": dict_row,
                "options": (
                    f"-c statement_timeout={STATEMENT_TIMEOUT_MS} "
                    "-c default_transaction_read_only=on"
                ),
            },
            open=False,
        )
        _pool.open(wait=True, timeout=15)
    return _pool


def query(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            return cur.fetchall()


def one(sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def writer_enabled() -> bool:
    """是否具备写设置的能力（未配置写账号时为 False）。"""
    return bool(SETTINGS_DATABASE_URL)


def writer_pool() -> ConnectionPool:
    """写连接池：独立于业务只读池，不加 default_transaction_read_only。

    范围靠数据库授权收紧——账号只对 settings 表有写权限，碰不到行程数据。
    """
    global _writer_pool
    if not SETTINGS_DATABASE_URL:
        raise RuntimeError("未配置 SETTINGS_DATABASE_URL，看板没有写入能力")
    if _writer_pool is None:
        _writer_pool = ConnectionPool(
            SETTINGS_DATABASE_URL,
            min_size=1,
            max_size=1,
            kwargs={
                "row_factory": dict_row,
                "options": f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
            },
            open=False,
        )
        _writer_pool.open(wait=True, timeout=15)
    return _writer_pool


def execute(sql: str, params: dict[str, Any] | None = None) -> int:
    """执行写语句，返回影响行数。"""
    with writer_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            return cur.rowcount


def one_write(sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """在写连接池上执行一条可能带 RETURNING 的语句，返回第一行。

    写操作必须走 writer_pool——业务池带 default_transaction_read_only=on，
    在那里 INSERT 会直接报「不能在一个只读模式的事务中执行」。
    """
    with writer_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            row = cur.fetchone()
            return row


def ping() -> dict[str, Any]:
    row = one("SELECT current_database() AS db, version() AS version")
    return row or {}


__all__: Sequence[str] = (
    "query",
    "one",
    "one_write",
    "ping",
    "pool",
    "execute",
    "writer_enabled",
    "writer_pool",
)
