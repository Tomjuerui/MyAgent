"""
Mock ERP 主服务（FastAPI + SQLite）
按原 Java ERP 的 REST 契约实现 23 个端点，统一响应包装 {code, message, data}，
分页响应 {records, total, current, size, pages}——与 src/mcp_server/http_base.py 的
解析逻辑和各 MCP 工具 docstring 完全对齐，Agent 侧零感知。

启动：python -m src.mock_erp.main   （默认 0.0.0.0:8081，可用 ERP_MOCK_HOST / ERP_MOCK_PORT 覆盖）
重置：MOCK_ERP_RESET=1 python -m src.mock_erp.main   （删除库文件并重新生成种子数据）
"""
import math
import os
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from fastapi import FastAPI, Query
from pydantic import BaseModel

from .db import (
    NEXT_STATUS, STATUS_LABELS, db_tx, init_db, is_empty, query_all, query_one,
    reset_db,
)
from .seed import seed_db


# ============ 生命周期 ============
@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("MOCK_ERP_RESET") == "1":
        reset_db()
    else:
        init_db()
    if is_empty():
        seed_db()
    yield


app = FastAPI(title="Mock ERP", description="本地迷你 ERP（电子元器件采购场景）", lifespan=lifespan)


# ============ 统一响应包装 ============
def ok(data=None) -> dict:
    return {"code": 200, "message": "success", "data": data}


def err(code: int, message: str) -> dict:
    return {"code": code, "message": message, "data": None}


# ============ 序列化（snake_case 库行 → camelCase API 字段，与原 Java ERP 对齐） ============
def supplier_dict(row: dict) -> dict:
    return {
        "id": row["id"], "supplierCode": row["supplier_code"], "name": row["name"],
        "contactPerson": row["contact_person"], "phone": row["phone"], "email": row["email"],
        "address": row["address"], "creditRating": row["credit_rating"],
        "status": row["status"], "createdAt": row.get("created_at"),
    }


def part_dict(row: dict) -> dict:
    return {
        "id": row["id"], "partCode": row["part_code"], "name": row["name"],
        "model": row["model"], "specification": row["specification"], "unit": row["unit"],
        "purchasePrice": row["purchase_price"],
        "suggestedRetailPrice": row.get("suggested_retail_price"),
        "stockWarningValue": row["stock_warning_value"], "supplierId": row["supplier_id"],
        "supplierName": row.get("supplier_name"), "category": row["category"],
        "description": row["description"],
    }


def _detail_dict(row: dict) -> dict:
    return {
        "id": row["id"], "orderId": row["order_id"], "partId": row["part_id"],
        "partName": row.get("part_name"), "partCode": row.get("part_code"),
        "quantity": row["quantity"], "unitPrice": row["unit_price"],
        "amount": round(row["quantity"] * row["unit_price"], 2), "remark": row.get("remark"),
    }


def order_dict(row: dict) -> dict:
    details = query_all(
        "SELECT d.*, p.name AS part_name, p.part_code FROM order_details d "
        "JOIN parts p ON p.id = d.part_id WHERE d.order_id = ? ORDER BY d.id",
        (row["id"],),
    )
    return {
        "id": row["id"], "orderNumber": row["order_number"],
        "totalAmount": row["total_amount"], "status": row["status"],
        "statusLabel": STATUS_LABELS.get(row["status"]),
        "remark": row["remark"], "orderTime": row["order_time"],
        "createdAt": row.get("created_at"),
        "orderDetail": [_detail_dict(d) for d in details],
    }


def _part_detail(row: dict) -> dict:
    return {
        "partId": row["part_id"], "partCode": row["part_code"], "partName": row["part_name"],
        "model": row.get("model"), "unit": row.get("unit"),
        "purchasePrice": row.get("purchase_price"), "category": row.get("category"),
    }


def inventory_dict(row: dict) -> dict:
    data = {
        "id": row["id"], "partId": row["part_id"],
        "currentQuantity": row["current_quantity"], "safetyStock": row["safety_stock"],
        "warehouseLocation": row["warehouse_location"], "updatedAt": row.get("updated_at"),
        "partDetail": _part_detail(row),
    }
    if "supplier_name" in row:
        data["partDetail"]["supplierName"] = row["supplier_name"]
    return data


def paginate(sql: str, count_sql: str, params: tuple, current: int, size: int) -> dict:
    """统一分页包装：{records, total, current, size, pages}"""
    total = query_one(count_sql, params)["n"]
    offset = (max(current, 1) - 1) * size
    rows = query_all(sql + " LIMIT ? OFFSET ?", params + (size, offset))
    return {
        "records": rows, "total": total, "current": max(current, 1),
        "size": size, "pages": math.ceil(total / size) if size else 0,
    }


# ============ 健康检查 ============
@app.get("/health")
def health():
    low = query_one(
        "SELECT COUNT(*) AS n FROM inventory WHERE current_quantity < safety_stock"
    )["n"]
    return ok({
        "service": "mock-erp",
        "suppliers": query_one("SELECT COUNT(*) AS n FROM suppliers")["n"],
        "parts": query_one("SELECT COUNT(*) AS n FROM parts")["n"],
        "orders": query_one("SELECT COUNT(*) AS n FROM purchase_orders")["n"],
        "lowStockItems": low,
    })


# ============================================================
# 供应商管理（5 个端点）
# ============================================================
@app.get("/api/suppliers/search")
def supplier_search(name: str = Query(..., min_length=1)):
    rows = query_all(
        "SELECT * FROM suppliers WHERE name LIKE ? ORDER BY id", (f"%{name}%",)
    )
    return ok([supplier_dict(r) for r in rows])


@app.get("/api/suppliers/page")
def supplier_page(
    current: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    name: Optional[str] = None,
    status: Optional[int] = None,
    credit_rating: Optional[str] = Query(None, alias="creditRating"),
):
    clauses, params = ["1=1"], []
    if name:
        clauses.append("name LIKE ?")
        params.append(f"%{name}%")
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if credit_rating:
        clauses.append("credit_rating = ?")
        params.append(credit_rating)
    where = " AND ".join(clauses)
    page = paginate(
        f"SELECT * FROM suppliers WHERE {where} ORDER BY id",
        f"SELECT COUNT(*) AS n FROM suppliers WHERE {where}",
        tuple(params), current, size,
    )
    page["records"] = [supplier_dict(r) for r in page["records"]]
    return ok(page)


@app.get("/api/suppliers/get/{supplier_id}")
def supplier_get(supplier_id: int):
    row = query_one("SELECT * FROM suppliers WHERE id = ?", (supplier_id,))
    if not row:
        return err(404, f"供应商不存在: id={supplier_id}")
    return ok(supplier_dict(row))


@app.post("/api/suppliers/create")
def supplier_create(body: dict):
    if not body.get("supplierCode") or not body.get("name"):
        return err(400, "supplierCode 和 name 为必填字段")
    if query_one("SELECT id FROM suppliers WHERE supplier_code = ?", (body["supplierCode"],)):
        return err(400, f"供应商编码已存在: {body['supplierCode']}")
    row_id = query_one("SELECT MAX(id) AS n FROM suppliers")["n"] or 0
    with db_tx() as conn:
        cur = conn.execute(
            "INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, credit_rating, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                body["supplierCode"], body["name"], body.get("contactPerson"),
                body.get("phone"), body.get("email"), body.get("address"),
                body.get("creditRating", "B"), body.get("status", 1),
            ),
        )
        row_id = cur.lastrowid
    return ok(supplier_dict(query_one("SELECT * FROM suppliers WHERE id = ?", (row_id,))))


@app.patch("/api/suppliers/update-status/{supplier_id}")
def supplier_update_status(supplier_id: int, status: int = Query(...)):
    if status not in (0, 1):
        return err(400, "status 取值非法：1=合作中, 0=已停止")
    if not query_one("SELECT id FROM suppliers WHERE id = ?", (supplier_id,)):
        return err(404, f"供应商不存在: id={supplier_id}")
    with db_tx() as conn:
        conn.execute("UPDATE suppliers SET status = ? WHERE id = ?", (status, supplier_id))
    return ok(supplier_dict(query_one("SELECT * FROM suppliers WHERE id = ?", (supplier_id,))))


# ============================================================
# 元器件管理（5 个端点）
# ============================================================
_PART_SELECT = (
    "SELECT p.*, s.name AS supplier_name FROM parts p "
    "LEFT JOIN suppliers s ON s.id = p.supplier_id"
)


@app.get("/api/parts/get/{part_id}")
def part_get(part_id: int):
    row = query_one(f"{_PART_SELECT} WHERE p.id = ?", (part_id,))
    if not row:
        return err(404, f"元器件不存在: id={part_id}")
    return ok(part_dict(row))


@app.get("/api/parts/search")
def part_search(name: str = Query(..., min_length=1)):
    rows = query_all(f"{_PART_SELECT} WHERE p.name LIKE ? ORDER BY p.id", (f"%{name}%",))
    return ok([part_dict(r) for r in rows])


@app.get("/api/parts/supplier/{supplier_id}")
def part_by_supplier(supplier_id: int):
    rows = query_all(f"{_PART_SELECT} WHERE p.supplier_id = ? ORDER BY p.id", (supplier_id,))
    return ok([part_dict(r) for r in rows])


@app.get("/api/parts/page")
def part_page(
    current: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    name: Optional[str] = None,
    category: Optional[str] = None,
    supplier_id: Optional[int] = Query(None, alias="supplierId"),
):
    clauses, params = ["1=1"], []
    if name:
        clauses.append("p.name LIKE ?")
        params.append(f"%{name}%")
    if category:
        clauses.append("p.category = ?")
        params.append(category)
    if supplier_id is not None:
        clauses.append("p.supplier_id = ?")
        params.append(supplier_id)
    where = " AND ".join(clauses)
    page = paginate(
        f"{_PART_SELECT} WHERE {where} ORDER BY p.id",
        f"SELECT COUNT(*) AS n FROM parts p WHERE {where}",
        tuple(params), current, size,
    )
    page["records"] = [part_dict(r) for r in page["records"]]
    return ok(page)


@app.post("/api/parts/create")
def part_create(body: dict):
    if not body.get("partCode") or not body.get("name"):
        return err(400, "partCode 和 name 为必填字段")
    if body.get("purchasePrice") is None or body["purchasePrice"] < 0:
        return err(400, "purchasePrice 为必填且 >= 0")
    if query_one("SELECT id FROM parts WHERE part_code = ?", (body["partCode"],)):
        return err(400, f"元器件编码已存在: {body['partCode']}")
    if body.get("supplierId") and not query_one(
        "SELECT id FROM suppliers WHERE id = ?", (body["supplierId"],)
    ):
        return err(404, f"供应商不存在: id={body['supplierId']}")
    with db_tx() as conn:
        cur = conn.execute(
            "INSERT INTO parts (part_code, name, model, specification, unit, purchase_price, "
            "suggested_retail_price, stock_warning_value, supplier_id, category, description) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                body["partCode"], body["name"], body.get("model"), body.get("specification"),
                body.get("unit", "个"), body["purchasePrice"], body.get("suggestedRetailPrice"),
                body.get("stockWarningValue", 0), body.get("supplierId"), body.get("category"),
                body.get("description"),
            ),
        )
        row_id = cur.lastrowid
    return ok(part_dict(query_one(f"{_PART_SELECT} WHERE p.id = ?", (row_id,))))


# ============================================================
# 采购订单管理（7 个端点）
# ============================================================
class OrderDetailIn(BaseModel):
    partId: int
    quantity: int
    unitPrice: float
    remark: Optional[str] = None


class OrderIn(BaseModel):
    orderNumber: str
    totalAmount: Optional[float] = None
    status: int = 0
    remark: Optional[str] = None
    orderDetail: list[OrderDetailIn]


def _validate_details(details: list[OrderDetailIn]):
    """校验明细并返回计算后的金额；不合法时返回 (None, 错误信息)"""
    total = 0.0
    for d in details:
        if d.quantity < 1:
            return None, f"明细数量必须 >= 1: partId={d.partId}"
        if d.unitPrice <= 0:
            return None, f"明细单价必须 > 0: partId={d.partId}"
        if not query_one("SELECT id FROM parts WHERE id = ?", (d.partId,)):
            return None, f"元器件不存在: partId={d.partId}"
        total += d.quantity * d.unitPrice
    return round(total, 2), None


@app.post("/api/orders/create")
def order_create(body: OrderIn):
    if query_one("SELECT id FROM purchase_orders WHERE order_number = ?", (body.orderNumber,)):
        return err(400, f"订单编号已存在: {body.orderNumber}")
    if not body.orderDetail:
        return err(400, "订单明细不能为空")
    total, error = _validate_details(body.orderDetail)
    if error:
        return err(400, error)
    if body.status not in STATUS_LABELS:
        return err(400, f"status 取值非法: {body.status}（0=待审核 1=已审核 2=已发货 3=已收货 4=已完成）")
    with db_tx() as conn:
        cur = conn.execute(
            "INSERT INTO purchase_orders (order_number, total_amount, status, remark, order_time) "
            "VALUES (?, ?, ?, ?, datetime('now', 'localtime'))",
            (body.orderNumber, total, body.status, body.remark),
        )
        order_id = cur.lastrowid
        for d in body.orderDetail:
            conn.execute(
                "INSERT INTO order_details (order_id, part_id, quantity, unit_price, remark) "
                "VALUES (?, ?, ?, ?, ?)",
                (order_id, d.partId, d.quantity, d.unitPrice, d.remark),
            )
    return ok(order_dict(query_one("SELECT * FROM purchase_orders WHERE id = ?", (order_id,))))


@app.put("/api/orders/update/{order_id}")
def order_update(order_id: int, body: OrderIn):
    row = query_one("SELECT * FROM purchase_orders WHERE id = ?", (order_id,))
    if not row:
        return err(404, f"订单不存在: id={order_id}")
    # 已发货/已收货/已完成订单进入履约流程，禁止修改
    if row["status"] not in (0, 1):
        return err(400, f"当前状态不可修改: {STATUS_LABELS[row['status']]}")
    if not body.orderDetail:
        return err(400, "订单明细不能为空")
    total, error = _validate_details(body.orderDetail)
    if error:
        return err(400, error)
    with db_tx() as conn:
        conn.execute("DELETE FROM order_details WHERE order_id = ?", (order_id,))
        conn.execute(
            "UPDATE purchase_orders SET order_number = ?, total_amount = ?, status = ?, remark = ? "
            "WHERE id = ?",
            (body.orderNumber, total, row["status"], body.remark, order_id),
        )
        for d in body.orderDetail:
            conn.execute(
                "INSERT INTO order_details (order_id, part_id, quantity, unit_price, remark) "
                "VALUES (?, ?, ?, ?, ?)",
                (order_id, d.partId, d.quantity, d.unitPrice, d.remark),
            )
    return ok(order_dict(query_one("SELECT * FROM purchase_orders WHERE id = ?", (order_id,))))


@app.get("/api/orders/page")
def order_page(
    current: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    order_number: Optional[str] = Query(None, alias="orderNumber"),
    status: Optional[int] = None,
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date: Optional[str] = Query(None, alias="endDate"),
):
    clauses, params = ["1=1"], []
    if order_number:
        clauses.append("order_number LIKE ?")
        params.append(f"%{order_number}%")
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if start_date:
        clauses.append("date(order_time) >= date(?)")
        params.append(start_date)
    if end_date:
        clauses.append("date(order_time) <= date(?)")
        params.append(end_date)
    where = " AND ".join(clauses)
    page = paginate(
        f"SELECT * FROM purchase_orders WHERE {where} ORDER BY order_time DESC",
        f"SELECT COUNT(*) AS n FROM purchase_orders WHERE {where}",
        tuple(params), current, size,
    )
    page["records"] = [order_dict(r) for r in page["records"]]
    return ok(page)


@app.get("/api/orders/get/{order_id}")
def order_get(order_id: int):
    row = query_one("SELECT * FROM purchase_orders WHERE id = ?", (order_id,))
    if not row:
        return err(404, f"订单不存在: id={order_id}")
    return ok(order_dict(row))


@app.get("/api/orders/search-details")
def order_search_details(
    part_name: Optional[str] = Query(None, alias="partName"),
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date: Optional[str] = Query(None, alias="endDate"),
):
    clauses, params = ["1=1"], []
    if part_name:
        clauses.append("p.name LIKE ?")
        params.append(f"%{part_name}%")
    if start_date:
        clauses.append("date(o.order_time) >= date(?)")
        params.append(start_date)
    if end_date:
        clauses.append("date(o.order_time) <= date(?)")
        params.append(end_date)
    where = " AND ".join(clauses)
    rows = query_all(
        "SELECT d.id, d.order_id, d.part_id, d.quantity, d.unit_price, d.remark, "
        "o.order_number, o.order_time, o.status, "
        "p.part_code, p.name AS part_name, p.category, "
        "p.supplier_id, s.name AS supplier_name "
        f"FROM order_details d JOIN purchase_orders o ON o.id = d.order_id "
        "JOIN parts p ON p.id = d.part_id LEFT JOIN suppliers s ON s.id = p.supplier_id "
        f"WHERE {where} ORDER BY o.order_time DESC LIMIT 500",
        tuple(params),
    )
    return ok([
        {
            "id": r["id"], "orderId": r["order_id"], "orderNumber": r["order_number"],
            "orderTime": r["order_time"], "orderStatus": r["status"],
            "statusLabel": STATUS_LABELS.get(r["status"]),
            "partId": r["part_id"], "partName": r["part_name"], "partCode": r["part_code"],
            "category": r["category"], "supplierId": r["supplier_id"],
            "supplierName": r["supplier_name"],
            "quantity": r["quantity"], "unitPrice": r["unit_price"],
            "amount": round(r["quantity"] * r["unit_price"], 2), "remark": r["remark"],
        }
        for r in rows
    ])


@app.get("/api/orders/statistics")
def order_statistics(
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date: Optional[str] = Query(None, alias="endDate"),
):
    clauses, params = ["1=1"], []
    if start_date:
        clauses.append("date(order_time) >= date(?)")
        params.append(start_date)
    if end_date:
        clauses.append("date(order_time) <= date(?)")
        params.append(end_date)
    where = " AND ".join(clauses)
    total = query_one(
        f"SELECT COUNT(*) AS n, IFNULL(SUM(total_amount), 0) AS amount "
        f"FROM purchase_orders WHERE {where}", tuple(params),
    )
    status_rows = query_all(
        f"SELECT status, COUNT(*) AS n FROM purchase_orders WHERE {where} "
        "GROUP BY status", tuple(params),
    )
    return ok({
        "totalOrders": total["n"],
        "totalAmount": round(total["amount"], 2),
        "statusCount": {str(r["status"]): r["n"] for r in status_rows},
        "statusLabels": STATUS_LABELS,
    })


@app.patch("/api/orders/update-status/{order_id}")
def order_update_status(order_id: int, status: int = Query(...)):
    row = query_one("SELECT * FROM purchase_orders WHERE id = ?", (order_id,))
    if not row:
        return err(404, f"订单不存在: id={order_id}")
    if status not in STATUS_LABELS:
        return err(400, f"status 取值非法: {status}（0=待审核 1=已审核 2=已发货 3=已收货 4=已完成）")
    cur_status = row["status"]
    if status == cur_status:
        return err(400, f"订单已处于该状态: {STATUS_LABELS[cur_status]}")
    if NEXT_STATUS[cur_status] != status:
        return err(
            400,
            f"非法状态流转: {STATUS_LABELS[cur_status]}({cur_status}) -> {STATUS_LABELS[status]}({status})，"
            f"仅允许推进到 {STATUS_LABELS.get(NEXT_STATUS[cur_status])}({NEXT_STATUS[cur_status]})",
        )
    with db_tx() as conn:
        conn.execute("UPDATE purchase_orders SET status = ? WHERE id = ?", (status, order_id))
    return ok(order_dict(query_one("SELECT * FROM purchase_orders WHERE id = ?", (order_id,))))


# ============================================================
# 库存管理（6 个端点）
# ============================================================
_INVENTORY_SELECT = (
    "SELECT i.*, p.part_code, p.name AS part_name, p.model, p.unit, "
    "p.purchase_price, p.category, s.name AS supplier_name "
    "FROM inventory i JOIN parts p ON p.id = i.part_id "
    "LEFT JOIN suppliers s ON s.id = p.supplier_id"
)


@app.get("/api/inventory/warning")
def inventory_warning():
    rows = query_all(
        f"{_INVENTORY_SELECT} WHERE i.current_quantity < i.safety_stock "
        "ORDER BY i.safety_stock - i.current_quantity DESC"
    )
    result = []
    for r in rows:
        data = inventory_dict(r)
        data["shortage"] = r["safety_stock"] - r["current_quantity"]
        result.append(data)
    return ok(result)


@app.get("/api/inventory/page")
def inventory_page(
    current: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    part_name: Optional[str] = Query(None, alias="partName"),
    warehouse_location: Optional[str] = Query(None, alias="warehouseLocation"),
):
    clauses, params = ["1=1"], []
    if part_name:
        clauses.append("p.name LIKE ?")
        params.append(f"%{part_name}%")
    if warehouse_location:
        clauses.append("i.warehouse_location LIKE ?")
        params.append(f"%{warehouse_location}%")
    where = " AND ".join(clauses)
    page = paginate(
        f"{_INVENTORY_SELECT} WHERE {where} ORDER BY i.id",
        f"SELECT COUNT(*) AS n FROM inventory i JOIN parts p ON p.id = i.part_id WHERE {where}",
        tuple(params), current, size,
    )
    page["records"] = [inventory_dict(r) for r in page["records"]]
    return ok(page)


@app.get("/api/inventory/check")
def inventory_check():
    row = query_one(
        "SELECT COUNT(*) AS total_sku, "
        "SUM(CASE WHEN current_quantity < safety_stock THEN 1 ELSE 0 END) AS warning_count, "
        "IFNULL(SUM(i.current_quantity), 0) AS total_quantity "
        "FROM inventory i"
    )
    value_row = query_one(
        "SELECT IFNULL(SUM(i.current_quantity * p.purchase_price), 0) AS total_value "
        "FROM inventory i JOIN parts p ON p.id = i.part_id"
    )
    return ok({
        "totalSku": row["total_sku"],
        "warningCount": row["warning_count"],
        "totalQuantity": row["total_quantity"],
        "totalValue": round(value_row["total_value"], 2),
    })


@app.post("/api/inventory/inbound")
def inventory_inbound(
    part_id: int = Query(..., alias="partId"),
    quantity: int = Query(..., gt=0),
    warehouse_location: Optional[str] = Query(None, alias="warehouseLocation"),
):
    part = query_one("SELECT * FROM parts WHERE id = ?", (part_id,))
    if not part:
        return err(404, f"元器件不存在: partId={part_id}")
    with db_tx() as conn:
        row = conn.execute("SELECT * FROM inventory WHERE part_id = ?", (part_id,)).fetchone()
        if row:
            conn.execute(
                "UPDATE inventory SET current_quantity = current_quantity + ?, "
                "warehouse_location = COALESCE(?, warehouse_location), "
                "updated_at = datetime('now', 'localtime') WHERE part_id = ?",
                (quantity, warehouse_location, part_id),
            )
        else:
            conn.execute(
                "INSERT INTO inventory (part_id, current_quantity, safety_stock, warehouse_location) "
                "VALUES (?, ?, ?, ?)",
                (part_id, quantity, part["stock_warning_value"],
                 warehouse_location or "A-01-01"),
            )
    data = query_one(f"{_INVENTORY_SELECT} WHERE i.part_id = ?", (part_id,))
    return ok({"partId": part_id, "inboundQuantity": quantity,
               "currentQuantity": data["current_quantity"],
               "warehouseLocation": data["warehouse_location"]})


@app.post("/api/inventory/outbound")
def inventory_outbound(
    part_id: int = Query(..., alias="partId"),
    quantity: int = Query(..., gt=0),
):
    part = query_one("SELECT * FROM parts WHERE id = ?", (part_id,))
    if not part:
        return err(404, f"元器件不存在: partId={part_id}")
    row = query_one("SELECT * FROM inventory WHERE part_id = ?", (part_id,))
    if not row:
        return err(400, f"该元器件暂无库存记录: partId={part_id}")
    if row["current_quantity"] < quantity:
        return err(
            400,
            f"库存不足: {part['name']} 当前库存 {row['current_quantity']}，"
            f"请求出库 {quantity}",
        )
    with db_tx() as conn:
        conn.execute(
            "UPDATE inventory SET current_quantity = current_quantity - ?, "
            "updated_at = datetime('now', 'localtime') WHERE part_id = ?",
            (quantity, part_id),
        )
    return ok({"partId": part_id, "outboundQuantity": quantity,
               "currentQuantity": row["current_quantity"] - quantity})


@app.get("/api/inventory/get/{inventory_id}")
def inventory_get(inventory_id: int):
    row = query_one(f"{_INVENTORY_SELECT} WHERE i.id = ?", (inventory_id,))
    if not row:
        return err(404, f"库存记录不存在: id={inventory_id}")
    return ok(inventory_dict(row))


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("ERP_MOCK_HOST", "0.0.0.0"),
        port=int(os.getenv("ERP_MOCK_PORT", "8081")),
    )
