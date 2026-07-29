# Mock ERP 接口契约

本地迷你 ERP（FastAPI + SQLite，电子元器件采购场景）对外暴露的全部接口。
`src/mcp_server/` 的 23 个 MCP 工具是这 23 个端点的唯一消费方；将来接真实 ERP 时，
只需让真实服务满足本契约并修改 `ERP_BASE_URL`，Agent 与 MCP 层零改动。

## 启动与重置

```bash
python -m src.mock_erp.main                    # 启动，默认 0.0.0.0:8081
ERP_MOCK_PORT=8082 python -m src.mock_erp.main # 自定义端口
MOCK_ERP_RESET=1 python -m src.mock_erp.main   # 删除 erp.db 并重新灌种子数据
python -m src.mock_erp.smoke_test              # 契约冒烟测试（102 项断言）
```

首次启动自动建表并灌入种子数据（`random.seed(42)` 可复现）：
15 家供应商 / 36 种元器件 / 36 条库存（7 条低于安全库存）/ 62 笔订单（5 笔待审核）。
数据持久在 `src/mock_erp/erp.db`，重启不丢——HITL 审批、出入库的结果都能跨进程保留。

## 通用约定

- 所有响应 HTTP 200，统一包装：`{"code": 200, "message": "success", "data": ...}`
- 业务错误：HTTP 仍为 200，`code` 为 400（业务规则）/ 404（资源不存在），`data: null`
- 分页参数：`current`（页码，>=1）、`size`（每页，1-100）
- 分页响应 `data`：`{"records": [...], "total": n, "current": n, "size": n, "pages": n}`
- 字段命名 camelCase（与原 Java ERP 一致）
- 订单状态机：`0=待审核 → 1=已审核 → 2=已发货 → 3=已收货 → 4=已完成`，仅允许线性推进，跳级/回退/同状态返回 400

## 端点清单（23 个）

### 供应商（5）

| 方法 | 路径 | 参数 / 请求体 | data |
|------|------|--------------|------|
| GET | `/api/suppliers/search` | `?name=`（必填，模糊） | 供应商数组 |
| GET | `/api/suppliers/page` | `?current&size&name&status&creditRating` | 分页 |
| GET | `/api/suppliers/get/{id}` | — | 供应商对象（supplierCode/name/contactPerson/phone/email/address/creditRating/status） |
| POST | `/api/suppliers/create` | `{supplierCode*, name*, contactPerson?, phone?, email?, address?, creditRating?, status?}` | 供应商对象 |
| PATCH | `/api/suppliers/update-status/{id}` | `?status=`（1=合作中, 0=已停止） | 供应商对象 |

### 元器件（5）

| 方法 | 路径 | 参数 / 请求体 | data |
|------|------|--------------|------|
| GET | `/api/parts/get/{id}` | — | 元器件对象（partCode/name/model/specification/unit/purchasePrice/suggestedRetailPrice/stockWarningValue/supplierId/supplierName/category/description） |
| GET | `/api/parts/search` | `?name=`（必填，模糊，匹配名称字段） | 元器件数组 |
| GET | `/api/parts/supplier/{supplier_id}` | — | 元器件数组 |
| GET | `/api/parts/page` | `?current&size&name&category&supplierId` | 分页 |
| POST | `/api/parts/create` | `{partCode*, name*, purchasePrice**, model?, specification?, unit?, suggestedRetailPrice?, stockWarningValue?, supplierId?, category?, description?}` | 元器件对象 |

> 注意：`name` 类模糊搜索只匹配**名称字段**（如"温湿度传感器"），型号（如 `DS18B20`）需走 `model` 相关查询或换名称关键字。

### 采购订单（7）

| 方法 | 路径 | 参数 / 请求体 | data |
|------|------|--------------|------|
| POST | `/api/orders/create` | `{orderNumber*, status?, remark?, orderDetail*: [{partId*, quantity**(≥1), unitPrice**(>0), remark?}]}` | 订单对象（含明细） |
| PUT | `/api/orders/update/{id}` | 请求体同 create | 订单对象（仅待审核/已审核可改） |
| GET | `/api/orders/page` | `?current&size&orderNumber&status&startDate&endDate`（yyyy-MM-dd，含端点） | 分页 |
| GET | `/api/orders/get/{id}` | — | 订单对象（orderNumber/totalAmount/status/orderTime/orderDetail[]） |
| GET | `/api/orders/search-details` | `?partName&startDate&endDate` | 明细数组（联查元器件 + 供应商） |
| GET | `/api/orders/statistics` | `?startDate&endDate` | `{totalOrders, totalAmount, statusCount, statusLabels}` |
| PATCH | `/api/orders/update-status/{id}` | `?status=`（0-4，线性推进） | 订单对象 |

- `totalAmount` 服务端按 `Σ(quantity × unitPrice)` 重算，请求体传入值被忽略
- `orderNumber` 全局唯一，重复返回 400
- `partId` 不存在 / `quantity < 1` / `unitPrice <= 0` 返回 400

### 库存（6）

| 方法 | 路径 | 参数 / 请求体 | data |
|------|------|--------------|------|
| GET | `/api/inventory/warning` | — | 预警数组（`currentQuantity < safetyStock`，含 partDetail + shortage，按缺口降序） |
| GET | `/api/inventory/page` | `?current&size&partName&warehouseLocation` | 分页（含 partDetail） |
| GET | `/api/inventory/check` | — | `{totalSku, warningCount, totalQuantity, totalValue}` |
| POST | `/api/inventory/inbound` | `?partId*&quantity**(>0)&warehouseLocation?` | `{partId, inboundQuantity, currentQuantity, warehouseLocation}` |
| POST | `/api/inventory/outbound` | `?partId*&quantity**(>0)` | `{partId, outboundQuantity, currentQuantity}` |
| GET | `/api/inventory/get/{id}` | — | 库存记录（含 partDetail） |

- 入库/出库真实增减库存并持久化；首次入库自动建库存记录（safety_stock 取元器件的 stockWarningValue）
- 出库超过当前库存返回 400（"库存不足"）

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 种子数据统计（suppliers/parts/orders/lowStockItems），供启动自检 |
