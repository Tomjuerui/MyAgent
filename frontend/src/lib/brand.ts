// 品牌与身份文案的唯一来源，改产品名只需改这里。
// 注意：userRole 会随聊天请求发给后端，最终进模型提示词
// （src/agent/memory/prompts.py:10 的「- 用户名: {username}」），不只是 UI 文案。
export const BRAND = {
  name: "DevEco Intelligence",
  tagline: "技术情报智能体",
  description: "开源开发者生态与技术趋势洞察智能体",
  userRole: "情报分析师",
  version: "v1.0.0",
} as const;
