// ERP 数据台 API：经 next.config.ts 的 /erp-api rewrite 转发到 mock-erp:8081/api
const BASE = "/erp-api";

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}
export interface PageResult<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

async function erpGet<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`ERP GET ${path} -> ${res.status}`);
  return res.json();
}
async function erpPost<T>(path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`ERP POST ${path} -> ${res.status}`);
  return res.json();
}
async function erpPatch<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE}${path}`, { method: "PATCH" });
  if (!res.ok) throw new Error(`ERP PATCH ${path} -> ${res.status}`);
  return res.json();
}

export const erp = {
  suppliers: {
    list: (p: { current?: number; size?: number; name?: string }) =>
      erpGet<any>(
        `/suppliers/page?current=${p.current ?? 1}&size=${p.size ?? 20}${p.name ? `&name=${encodeURIComponent(p.name)}` : ""}`
      ),
    create: (b: any) => erpPost<any>("/suppliers/create", b),
    updateStatus: (id: number, status: number) =>
      erpPatch<any>(`/suppliers/update-status/${id}?status=${status}`),
  },
  parts: {
    list: (p: { current?: number; size?: number; name?: string }) =>
      erpGet<any>(
        `/parts/page?current=${p.current ?? 1}&size=${p.size ?? 20}${p.name ? `&name=${encodeURIComponent(p.name)}` : ""}`
      ),
    create: (b: any) => erpPost<any>("/parts/create", b),
  },
  orders: {
    list: (p: { current?: number; size?: number; status?: number }) =>
      erpGet<any>(
        `/orders/page?current=${p.current ?? 1}&size=${p.size ?? 20}${p.status !== undefined ? `&status=${p.status}` : ""}`
      ),
    updateStatus: (id: number, status: number) =>
      erpPatch<any>(`/orders/update-status/${id}?status=${status}`),
  },
  inventory: {
    list: (p: { current?: number; size?: number; partName?: string }) =>
      erpGet<any>(
        `/inventory/page?current=${p.current ?? 1}&size=${p.size ?? 20}${p.partName ? `&partName=${encodeURIComponent(p.partName)}` : ""}`
      ),
    inbound: (partId: number, quantity: number) =>
      erpPost<any>(`/inventory/inbound?partId=${partId}&quantity=${quantity}`),
    outbound: (partId: number, quantity: number) =>
      erpPost<any>(`/inventory/outbound?partId=${partId}&quantity=${quantity}`),
  },
};
