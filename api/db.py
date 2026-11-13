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
STATEMENT_TIMEOUT_MS = int(os.environ.get("STATEMENT_TIMEOUT_MS", "20000"))
POOL_SIZE = int(os.environ.get("POOL_SIZE", "4"))

_pool: ConnectionPool | None = None


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


def ping() -> dict[str, Any]:
    row = one("SELECT current_database() AS db, version() AS version")
    return row or {}


__all__: Sequence[str] = ("query", "one", "ping", "pool")
