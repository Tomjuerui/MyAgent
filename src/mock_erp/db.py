"""
Mock ERP 数据库模块
标准库 sqlite3 持久化（零额外依赖）：建表 DDL + 查询/执行辅助函数
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "erp.db"

DDL = """
CREATE TABLE IF NOT EXISTS suppliers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_code  TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    contact_person TEXT,
    phone          TEXT,
    email          TEXT,
    address        TEXT,
    credit_rating  TEXT NOT NULL DEFAULT 'B',
    status         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS parts (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    part_code              TEXT NOT NULL UNIQUE,
    name                   TEXT NOT NULL,
    model                  TEXT,
    specification          TEXT,
    unit                   TEXT NOT NULL DEFAULT '个',
    purchase_price         REAL NOT NULL DEFAULT 0,
    suggested_retail_price REAL,
    stock_warning_value    INTEGER NOT NULL DEFAULT 0,
    supplier_id            INTEGER REFERENCES suppliers(id),
    category               TEXT,
    description            TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    total_amount REAL NOT NULL DEFAULT 0,
    status       INTEGER NOT NULL DEFAULT 0,
    remark       TEXT,
    order_time   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS order_details (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    part_id    INTEGER NOT NULL REFERENCES parts(id),
    quantity   INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    remark     TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id            INTEGER NOT NULL UNIQUE REFERENCES parts(id),
    current_quantity   INTEGER NOT NULL DEFAULT 0,
    safety_stock       INTEGER NOT NULL DEFAULT 0,
    warehouse_location TEXT NOT NULL DEFAULT 'A-01-01',
    updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_parts_supplier ON parts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_details_order  ON order_details(order_id);
CREATE INDEX IF NOT EXISTS idx_details_part   ON order_details(part_id);
CREATE INDEX IF NOT EXISTS idx_orders_time    ON purchase_orders(order_time);
"""

# 订单状态：0=待审核, 1=已审核, 2=已发货, 3=已收货, 4=已完成（与 order_tools.py 文档一致）
STATUS_LABELS = {0: "待审核", 1: "已审核", 2: "已发货", 3: "已收货", 4: "已完成"}
# 合法状态流转：严格线性，禁止跳级与回退
NEXT_STATUS = {0: 1, 1: 2, 2: 3, 3: 4, 4: None}


def get_conn() -> sqlite3.Connection:
    """新建连接（每请求一连接，规避 sqlite3 跨线程问题），Row 工厂方便转 dict"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """建表（幂等）"""
    with get_conn() as conn:
        conn.executescript(DDL)


def is_empty() -> bool:
    """业务表是否为空（用于启动时判断是否需要灌种子数据）"""
    row = query_one("SELECT COUNT(*) AS n FROM suppliers")
    return row["n"] == 0


def reset_db():
    """删除库文件并重建（配合 MOCK_ERP_RESET=1 强制重新生成种子数据）"""
    if DB_PATH.exists():
        DB_PATH.unlink()
    init_db()


def query_all(sql: str, params: tuple = ()) -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple = ()) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> int:
    """单条写操作，返回 lastrowid"""
    with get_conn() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid


@contextmanager
def db_tx():
    """多表写事务：order_create / order_update 需要订单与明细一起成功"""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
