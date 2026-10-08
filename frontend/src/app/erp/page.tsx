"use client";

import { useCallback, useEffect, useState } from "react";
import { erp } from "@/lib/erpApi";

type Tab = "suppliers" | "parts" | "orders" | "inventory";

const TABS: { key: Tab; label: string }[] = [
  { key: "suppliers", label: "供应商" },
  { key: "parts", label: "元器件" },
  { key: "orders", label: "采购订单" },
  { key: "inventory", label: "库存" },
];

const COLUMNS: Record<Tab, { key: string; label: string; render?: (r: any) => string }[]> = {
  suppliers: [
    { key: "id", label: "ID" },
    { key: "supplierCode", label: "编码" },
    { key: "name", label: "名称" },
    { key: "creditRating", label: "信用" },
    { key: "status", label: "状态", render: (r) => (r.status === 1 ? "合作中" : "已停止") },
  ],
  parts: [
    { key: "id", label: "ID" },
    { key: "partCode", label: "编码" },
    { key: "name", label: "名称" },
    { key: "model", label: "型号" },
    { key: "purchasePrice", label: "采购价" },
  ],
  orders: [
    { key: "id", label: "ID" },
    { key: "orderNumber", label: "单号" },
    { key: "totalAmount", label: "金额" },
    { key: "statusLabel", label: "状态" },
    { key: "orderTime", label: "时间" },
  ],
  inventory: [
    { key: "id", label: "ID" },
    { key: "partId", label: "元器件ID" },
    { key: "currentQuantity", label: "现库存" },
    { key: "safetyStock", label: "安全库存" },
    { key: "warehouseLocation", label: "库位" },
  ],
};

const STATUS_FLOW = [1, 2, 3, 4]; // 订单可推进到的下一状态

export default function ErpPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const fn =
        tab === "suppliers"
          ? erp.suppliers.list
          : tab === "parts"
          ? erp.parts.list
          : tab === "orders"
          ? erp.orders.list
          : erp.inventory.list;
      const res = await fn({});
      if (res.code === 200) {
        setRows(res.data.records ?? []);
        setTotal(res.data.total ?? 0);
        setErr("");
      }
    } catch (e) {
      setErr(String(e));
    }
  }, [tab]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000); // 轮询：agent 侧改动 3s 内可见
    return () => clearInterval(t);
  }, [load]);

  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      if (tab === "suppliers") {
        await erp.suppliers.create({
          supplierCode: form.supplierCode,
          name: form.name,
          creditRating: form.creditRating || "B",
        });
      } else if (tab === "parts") {
        await erp.parts.create({
          partCode: form.partCode,
          name: form.name,
          purchasePrice: Number(form.purchasePrice || 0),
        });
      }
      setForm({});
      load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const advanceOrder = async (id: number, curStatus: number) => {
    const next = STATUS_FLOW.find((s) => s > curStatus);
    if (next === undefined) return;
    try {
      await erp.orders.updateStatus(id, next);
      load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const moveStock = async (partId: number, dir: "in" | "out") => {
    const q = Number(window.prompt(`请输入${dir === "in" ? "入库" : "出库"}数量`));
    if (!q || q <= 0) return;
    try {
      await (dir === "in" ? erp.inventory.inbound(partId, q) : erp.inventory.outbound(partId, q));
      load();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-surface-050 p-4 text-ink-800">
      <div className="mb-3 flex items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === t.key
                ? "bg-signal-soft font-medium text-signal-lo"
                : "bg-surface-100 hover:bg-surface-200"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto ic-metric">共 {total} 条 · 3s 自动刷新</span>
      </div>

      {err && (
        <div className="mb-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          操作失败：{err}
        </div>
      )}

      {/* 创建表单（仅供应商/元器件） */}
      {(tab === "suppliers" || tab === "parts") && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-surface-100 p-3">
          {tab === "suppliers" ? (
            <>
              <input
                placeholder="编码 supplierCode"
                className="rounded border border-line-200 px-2 py-1.5"
                onChange={(e) => setF("supplierCode", e.target.value)}
              />
              <input
                placeholder="名称 name"
                className="rounded border border-line-200 px-2 py-1.5"
                onChange={(e) => setF("name", e.target.value)}
              />
              <input
                placeholder="信用评级(默认B)"
                className="rounded border border-line-200 px-2 py-1.5"
                onChange={(e) => setF("creditRating", e.target.value)}
              />
            </>
          ) : (
            <>
              <input
                placeholder="编码 partCode"
                className="rounded border border-line-200 px-2 py-1.5"
                onChange={(e) => setF("partCode", e.target.value)}
              />
              <input
                placeholder="名称 name"
                className="rounded border border-line-200 px-2 py-1.5"
                onChange={(e) => setF("name", e.target.value)}
              />
              <input
                placeholder="采购价 purchasePrice"
                className="rounded border border-line-200 px-2 py-1.5"
                onChange={(e) => setF("purchasePrice", e.target.value)}
              />
            </>
          )}
          <button onClick={submit} className="rounded-md bg-signal-lo px-3 py-1.5 text-sm text-white">
            新增
          </button>
        </div>
      )}

      {/* 数据表 */}
      <div className="overflow-auto rounded-lg border border-line-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-100 text-left">
            <tr>
              {COLUMNS[tab].map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line-100">
                {COLUMNS[tab].map((c) => (
                  <td key={c.key} className="px-3 py-1.5">
                    {c.render ? c.render(r) : (r[c.key] ?? "")}
                  </td>
                ))}
                <td className="px-3 py-1.5">
                  {tab === "orders" && r.status < 4 && (
                    <button
                      className="mr-2 text-signal-lo hover:underline"
                      onClick={() => advanceOrder(r.id, r.status)}
                    >
                      推进状态
                    </button>
                  )}
                  {tab === "inventory" && (
                    <>
                      <button
                        className="mr-2 text-signal-lo hover:underline"
                        onClick={() => moveStock(r.partId, "in")}
                      >
                        入库
                      </button>
                      <button
                        className="text-warning hover:underline"
                        onClick={() => moveStock(r.partId, "out")}
                      >
                        出库
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS[tab].length + 1} className="px-3 py-6 text-center text-ink-400">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
