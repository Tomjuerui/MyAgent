// 品牌与身份文案的唯一来源，改产品名只需改这里。
// 注意：userRole 会随聊天请求发给后端，最终进模型提示词
// （src/agent/memory/prompts.py:10 的「- 用户名: {username}」），不只是 UI 文案。
export const BRAND = {
  name: "知衡（ZhiHeng）",
  tagline: "电子元器件采购 Agent",
  description: "电子元器件采购管理智能助手：供应商分析、采购订单全生命周期、人工审批、库存联动",
  userRole: "采购专员",
  version: "v1.0.0",
} as const;
