"""
Mock ERP 冒烟测试（契约测试）
基于 FastAPI TestClient 进程内验证 23 个端点的响应包装、分页格式与核心业务规则：
状态机流转、库存增减与预警、订单金额一致性、唯一性约束。
运行：python -m src.mock_erp.smoke_test
"""
import os

os.environ["MOCK_ERP_RESET"] = "1"  # 每次测试都重建种子数据，保证断言稳定

from fastapi.testclient import TestClient  # noqa: E402

from .main import app  # noqa: E402

client = TestClient(app).__enter__()  # 进上下文才会触发 lifespan（建表 + 灌种子）
PASSED = 0


def check(name: str, condition: bool, detail: str = ""):
    global PASSED
    if not condition:
        raise AssertionError(f"[FAIL] {name} {detail}")
    PASSED += 1
    print(f"  [ok] {name}")


def expect_envelope(name: str, resp):
    """所有端点统一返回 HTTP 200 + {code, message, data} 包装"""
    check(f"{name}: HTTP 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    check(f"{name}: envelope", {"code", "message", "data"} <= set(body), str(body)[:200])
    return body


# ============ 健康检查 ============
print("== health ==")
body = expect_envelope("health", client.get("/health"))
check("health: 15 suppliers", body["data"]["suppliers"] == 15, str(body["data"]))
check("health: 36 parts", body["data"]["parts"] == 36, str(body["data"]))
check("health: 62 orders", body["data"]["orders"] == 62, str(body["data"]))
check("health: 7 low-stock", body["data"]["lowStockItems"] == 7, str(body["data"]))

# ============ 供应商（5 端点） ============
print("== suppliers ==")
body = expect_envelope("suppliers/search", client.get("/api/suppliers/search", params={"name": "立创"}))
check("search 立创 -> 1 家", len(body["data"]) == 1 and body["data"][0]["supplierCode"] == "SUP001", str(body["data"])[:120])

body = expect_envelope("suppliers/page", client.get("/api/suppliers/page", params={"current": 1, "size": 10}))
page = body["data"]
check("page keys", {"records", "total", "current", "size", "pages"} <= set(page), str(page)[:120])
check("page total=15", page["total"] == 15, str(page["total"]))
check("camelCase 字段", "creditRating" in page["records"][0] and "contactPerson" in page["records"][0])

body = expect_envelope("suppliers/page 过滤", client.get("/api/suppliers/page", params={"status": 0}))
check("status=0 -> 2 家已停止", body["data"]["total"] == 2, str(body["data"]["total"]))

body = expect_envelope("suppliers/get", client.get("/api/suppliers/get/1"))
check("get id=1", body["data"]["supplierCode"] == "SUP001")

body = expect_envelope("suppliers/create", client.post("/api/suppliers/create", json={
    "supplierCode": "SUP099", "name": "测试元器件商行", "creditRating": "B", "status": 1,
}))
new_sid = body["data"]["id"]
check("create 回读", body["data"]["name"] == "测试元器件商行")

dup = client.post("/api/suppliers/create", json={"supplierCode": "SUP099", "name": "重复编码"})
check("create 重复编码 -> 400", dup.json()["code"] == 400, str(dup.json()))

body = expect_envelope("suppliers/update-status", client.patch(f"/api/suppliers/update-status/{new_sid}", params={"status": 0}))
check("停用生效", body["data"]["status"] == 0)

# ============ 元器件（5 端点） ============
print("== parts ==")
body = expect_envelope("parts/get", client.get("/api/parts/get/1"))
check("parts/get 字段", {"partCode", "purchasePrice", "stockWarningValue", "supplierName"} <= set(body["data"]), str(body["data"])[:150])

body = expect_envelope("parts/search", client.get("/api/parts/search", params={"name": "电容"}))
names = [r["name"] for r in body["data"]]
check("search 电容 -> 2 种", len(names) == 2, str(names))

body = expect_envelope("parts/by-supplier", client.get("/api/parts/supplier/1"))
check("SUP001 供 4 种料", body["data"]["total"] if isinstance(body["data"], dict) else len(body["data"]) == 4, str(len(body["data"])))

body = expect_envelope("parts/page", client.get("/api/parts/page", params={"category": "被动元件"}))
check("被动元件 6 种", body["data"]["total"] == 6, str(body["data"]["total"]))

body = expect_envelope("parts/create", client.post("/api/parts/create", json={
    "partCode": "IC-9999", "name": "测试芯片", "purchasePrice": 5.5,
    "stockWarningValue": 100, "supplierId": 1, "category": "主控芯片",
}))
new_pid = body["data"]["id"]
check("create 回读价格", body["data"]["purchasePrice"] == 5.5)

bad = client.post("/api/parts/create", json={"partCode": "IC-0001", "name": "重复", "purchasePrice": 1})
check("create 重复编码 -> 400", bad.json()["code"] == 400)
bad = client.post("/api/parts/create", json={"partCode": "IC-9998", "name": "坏供应商", "purchasePrice": 1, "supplierId": 9999})
check("create 供应商不存在 -> 404", bad.json()["code"] == 404, str(bad.json()))

# ============ 库存（6 端点） ============
print("== inventory ==")
body = expect_envelope("inventory/warning", client.get("/api/inventory/warning"))
check("预警 7 条", len(body["data"]) == 7, str(len(body["data"])))
check("预警含 partDetail", "partDetail" in body["data"][0] and "shortage" in body["data"][0])

body = expect_envelope("inventory/page", client.get("/api/inventory/page", params={"partName": "电容"}))
check("库存分页 join partName", body["data"]["total"] == 2, str(body["data"]["total"]))  # 贴片电容100nF / 铝电解电容470uF

body = expect_envelope("inventory/check", client.get("/api/inventory/check"))
check("check: 36 SKU / 7 预警", body["data"]["totalSku"] == 36 and body["data"]["warningCount"] == 7, str(body["data"]))
check("check: 总价值 > 0", body["data"]["totalValue"] > 0)

ams = next(r for r in client.get("/api/inventory/page", params={"partName": "LDO稳压"}).json()["data"]["records"])
ams_qty = ams["currentQuantity"]
body = expect_envelope("inventory/inbound", client.post("/api/inventory/inbound", params={
    "partId": ams["partId"], "quantity": 100, "warehouseLocation": "B-01-05",
}))
check("入库后库存 +100", body["data"]["currentQuantity"] == ams_qty + 100, str(body["data"]))

body = expect_envelope("inventory/outbound", client.post("/api/inventory/outbound", params={
    "partId": ams["partId"], "quantity": 50,
}))
check("出库后库存 -50", body["data"]["currentQuantity"] == ams_qty + 50)

over = client.post("/api/inventory/outbound", params={"partId": ams["partId"], "quantity": 999999})
check("超量出库 -> 400", over.json()["code"] == 400 and "库存不足" in over.json()["message"], str(over.json()))

body = expect_envelope("inventory/get", client.get(f"/api/inventory/get/{ams['id']}"))
check("inventory/get 回读", body["data"]["currentQuantity"] == ams_qty + 50)

# ============ 订单（7 端点） ============
print("== orders ==")
body = expect_envelope("orders/page", client.get("/api/orders/page", params={"size": 5}))
check("订单分页含明细", "orderDetail" in body["data"]["records"][0])
check("按时间倒序", body["data"]["records"][0]["orderTime"] >= body["data"]["records"][-1]["orderTime"])

body = expect_envelope("orders/page 待审核", client.get("/api/orders/page", params={"status": 0}))
check("待审核 5 笔", body["data"]["total"] == 5, str(body["data"]["total"]))

body = expect_envelope("orders/page 日期过滤", client.get("/api/orders/page", params={"startDate": "2026-09-01", "endDate": "2026-09-30"}))
check("9月订单 8 笔", body["data"]["total"] == 8, str(body["data"]["total"]))

body = expect_envelope("orders/search-details", client.get("/api/orders/search-details", params={"partName": "温度传感器"}))
row = body["data"][0]
check("明细联查供应商", {"supplierName", "partCode", "orderNumber"} <= set(row), str(row)[:150])

body = expect_envelope("orders/statistics", client.get("/api/orders/statistics"))
check("统计总数 62", body["data"]["totalOrders"] == 62, str(body["data"]))
check("统计含待审核5", body["data"]["statusCount"].get("0") == 5, str(body["data"]["statusCount"]))

# --- 创建订单（金额服务端重算） ---
body = expect_envelope("orders/create", client.post("/api/orders/create", json={
    "orderNumber": "PO20260913001",
    "totalAmount": 999999.0,  # 服务端应忽略并重算
    "orderDetail": [
        {"partId": 1, "quantity": 100, "unitPrice": 8.5},
        {"partId": 7, "quantity": 50, "unitPrice": 3.2},
    ],
}))
new_oid = body["data"]["id"]
expected_total = round(100 * 8.5 + 50 * 3.2, 2)
check("金额服务端重算", body["data"]["totalAmount"] == expected_total, f"{body['data']['totalAmount']} != {expected_total}")
check("新订单状态待审核", body["data"]["status"] == 0 and body["data"]["statusLabel"] == "待审核")

dup = client.post("/api/orders/create", json={"orderNumber": "PO20260913001", "orderDetail": [{"partId": 1, "quantity": 1, "unitPrice": 1}]})
check("重复编号 -> 400", dup.json()["code"] == 400)
bad = client.post("/api/orders/create", json={"orderNumber": "PO20260913002", "orderDetail": [{"partId": 99999, "quantity": 1, "unitPrice": 1}]})
check("partId 不存在 -> 400", bad.json()["code"] == 400 and "元器件不存在" in bad.json()["message"])
bad = client.post("/api/orders/create", json={"orderNumber": "PO20260913002", "orderDetail": [{"partId": 1, "quantity": 0, "unitPrice": 1}]})
check("数量0 -> 400", bad.json()["code"] == 400)

# --- 修改订单 ---
body = expect_envelope("orders/update", client.put(f"/api/orders/update/{new_oid}", json={
    "orderNumber": "PO20260913001",
    "orderDetail": [{"partId": 1, "quantity": 200, "unitPrice": 8.5}],
}))
check("修改后金额重算", body["data"]["totalAmount"] == 1700.0 and len(body["data"]["orderDetail"]) == 1, str(body["data"])[:150])

# --- 状态机 ---
body = expect_envelope("update-status 0->1", client.patch(f"/api/orders/update-status/{new_oid}", params={"status": 1}))
check("审批通过 -> 已审核", body["data"]["status"] == 1)

jump = client.patch(f"/api/orders/update-status/{new_oid}", params={"status": 3})
check("跳级 1->3 -> 400", jump.json()["code"] == 400 and "非法状态流转" in jump.json()["message"], str(jump.json()))

body = expect_envelope("update-status 1->2", client.patch(f"/api/orders/update-status/{new_oid}", params={"status": 2}))
locked = client.put(f"/api/orders/update/{new_oid}", json={"orderNumber": "PO20260913001", "orderDetail": [{"partId": 1, "quantity": 1, "unitPrice": 1}]})
check("已发货订单禁止修改 -> 400", locked.json()["code"] == 400 and "不可修改" in locked.json()["message"])

body = expect_envelope("orders/get", client.get(f"/api/orders/get/{new_oid}"))
check("get 回读明细金额", body["data"]["orderDetail"][0]["amount"] == 1700.0)

# ============ 汇总 ============
print(f"\n全部通过: {PASSED} 项断言 ✓")
