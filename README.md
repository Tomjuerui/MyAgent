# DevEco-Intelligence DeepAgent — 开源生态技术情报智能体

> 基于 LangGraph + DeepAgent + 自研 Playwright-MCP 的多智能体长链路协同系统，自动完成「采集 → 分析 → 研报」全流程，严格遵循 Harness Engineering（Planning → Executing → Review → Result）。

---

## 项目简介

DevEco-Intelligence 是一个面向**开源开发者生态与技术趋势洞察**的 AI Agent。它接收自然语言指令，自主规划调研路径，通过**结构化 API 优先 + 浏览器兜底**的采集通道获取 GitHub Releases、HackerNews 热帖、arXiv 论文摘要等公开数据，执行交叉比对分析，并最终自动生成带趋势图表的可追溯研报：

- 开源框架发版追踪（LangGraph / CrewAI / AutoGen 等）
- 社区舆情摘要（HackerNews 热帖量化）
- 技术路线对比研报（特性覆盖度矩阵 + 发版周期趋势，带图表与来源 URL）

核心能力：

- 自研 Playwright-MCP 网页采集（3 工具 + 安全闸门：scheme/DNS/SSRF/白名单/限速）
- 主子 Agent 架构（ecosystem-crawler 采集提纯 → tech-analyst 分析出稿），规避 DOM 噪声污染主 Agent 上下文
- Harness 四阶段状态机 + Rubric 评审中间件，硬校验来源 URL 与数据真实性，拒绝幻觉
- HITL 双层闸门：前端审批卡（UI 放行）+ MCP 域名白名单（真正拦域名）
- 全链路可视化 Trace（每次工具调用耗时 / token 归因）
- **ERP 采购域作为第二业务域保留**，验证骨架可复用（见文末「第二业务域」）

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **LLM** | 本地 workbuddy2api-hub 反代网关 | 宿主 `:8788` 反代，`LLM_BASE_URL` 固定 `http://host.docker.internal:8788/v1`，模型由 `LLM_MODEL` 指定 |
| **Agent 框架** | DeepAgent + LangGraph | 状态图引擎，支持中断/恢复/子 Agent |
| **MCP 协议** | FastMCP + streamable-http | WebIntel-MCP（网页采集）+ ERP-MCP（采购工具域） |
| **Web 框架** | FastAPI + Uvicorn | SSE 流式响应 |
| **前端** | Next.js + React + TailwindCSS | 流式对话 UI + 中断交互 + Trace 面板 |
| **数据库** | MongoDB (Motor/Pymongo) | 会话/消息/Store/链路 Trace 持久化 |
| **沙箱** | Docker SDK + 7 层安全防护 | 隔离代码执行环境（图表/文档生成） |
| **图表** | Matplotlib + Pandas | 折线/柱状/雷达等图表生成 |
| **语言** | Python 3.11+ / TypeScript | 后端 Python，前端 TypeScript |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js :3000)                       │
│   SSE 流式对话 + HITL 审批卡 + 阶段条 + Trace 面板 + 历史管理      │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / SSE
┌────────────────────────────▼────────────────────────────────────┐
│              Backend API (FastAPI :8000)                          │
│   chat.py (SSE 流/中断/恢复) + history.py + agent_loader.py       │
│   MongoDBSaver + MongoDBStore + agent_traces（链路 Trace 落库）    │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              Agent Core (DeepAgent + LangGraph)                   │
│  ┌──────────┐ ┌───────────────┐ ┌──────────────┐ ┌───────────┐  │
│  │ LLM 网关 │ │ 9 中间件      │ │ 技术情报子Agent│ │ 采购子Agent│  │
│  │ :8788    │ │ (Harness/Rubric│ │ crawler      │ │ analyst   │  │
│  │          │ │ /HITL/Memory…)│ │ tech-analyst │ │ order     │  │
│  └──────────┘ └───────────────┘ └──────────────┘ └───────────┘  │
│  Tools: 结构化API(3) + WebIntel MCP(3) + ERP MCP(23) + 自定义(图表/文档/下载…)   │
└───────────┬───────────────────────────────────┬──────────────────┘
            │ streamable-http                    │ MCP (SSE)
┌───────────▼────────────────────┐  ┌───────────▼──────────────────┐
│  WebIntel-MCP (:9002)          │  │  ERP MCP Server (:9000)       │
│  mcp_browser_navigate          │  │  suppliers/parts/orders/      │
│  mcp_extract_table             │  │  inventory = 23 tools         │
│  mcp_take_screenshot           │  └───────────┬──────────────────┘
│  安全闸门: scheme→DNS→SSRF→    │              │ HTTP REST
│  白名单→限速→(DEMO rewrite)    │  ┌───────────▼──────────────────┐
└───────────┬────────────────────┘  │  ERP 后端 (:8081)             │
            │                       │  mock-erp（FastAPI+SQLite）   │
   ┌────────┴─────────┐             └──────────────────────────────┘
   │ 真实外网(白名单) │
   └────────┬─────────┘
   ┌────────┴─────────┐
   │ mock-web (:8080) │  ← DEMO_MODE=true 时改写 host 到此处（离线演示）
   │ nginx 假页面     │
   └──────────────────┘
```

---

## 核心功能

### 1. 采集双通道：结构化 API 优先 + 自研 Playwright-MCP 兜底

**API 优先通道**（`src/agent/tools/webintel_api.py`）：三个白名单域（github / HN / arXiv）都有官方结构化 API，URL 由代码构造、httpx 直连，秒级返回，无需浏览器与域名审批：

- `fetch_github_releases`：GitHub Releases 列表（版本号/日期/变更/URL）
- `fetch_hackernews_top`：HN 热帖（标题/热度/评论数/时间）
- `fetch_arxiv_papers`：arXiv 论文摘要（标题/摘要/日期/链接）

**浏览器兜底**（自研 Playwright-MCP，独立 FastMCP 服务 `D:\桌面\Brower_Use\webintel-mcp`，只读依赖）。MVP 白名单三域默认全走 API，浏览器仅在以下场景使用：API 失败/超时的重试路径、白名单外的 JS 渲染页面（需 HITL 审批并扩白名单）、截图取证。同时它承载「自研 MCP + 五重安全闸门」的工程展示价值：

- `mcp_browser_navigate`：无头 Chrome 导航 + Readability 提纯 Markdown
- `mcp_extract_table`：表格 → JSON/CSV
- `mcp_take_screenshot`：截图落盘共享卷 `/artifacts`

安全闸门按序执行：`scheme → DNS → 私有 IP/SSRF → 域名白名单 → 限速 → (DEMO 改写)`。拒绝即 MCP tool error，错误码稳定：`scheme_not_allowed / blocked_target / domain_not_allowed / rate_limited / navigation_timeout / extraction_failed`。

### 2. Harness 工作流（Planning → Executing → Review → Result）
- **Planning**：拆解调研 TodoList（前端实时展示）
- **Executing**：委派子 Agent / 调 MCP / 沙箱执行
- **Review**：Rubric 评审器核验来源 URL 与数据真实性，不达标自动打回重做
- **Result**：结构化输出，前端阶段条逐格点亮

### 3. HITL 双层闸门
- **UI 层**：`interrupt_on` 工具触发前端审批卡（访问外部网站 / 生成研报外发）
- **MCP 层**：域名白名单真正拦截（`domain_not_allowed`），approve 只是 UI 放行

### 4. 子 Agent 委派（YAML 声明式）
| 子 Agent | 域 | 职责 | 工具 |
|---|---|---|---|
| ecosystem-crawler | 技术情报 | API 优先采集 + 提纯，不回传原始 DOM | search_github_repos + fetch_* 3 工具 + mcp_browser_* 3 工具（兜底） |
| tech-analyst | 技术情报 | 交叉比对分析 + 图表 + 研报 | generate_chart / generate_document / generate_table_report |
| procurement-analyst | 采购（第二域） | 采购数据分析 + 图表 | ERP MCP 工具 |
| procurement-order | 采购（第二域） | 订单 CRUD + 审批 | ERP MCP 工具 |

子 Agent 配置见 `src/agent/subagents/configs/*.yaml`（工具集 / 系统提示词 / 委派协议 / interrupt_on）。

### 5. 9 层中间件栈
| # | 中间件 | 职责 |
|---|--------|------|
| 1 | SandboxHealthMiddleware | 沙箱健康检查 + 自动重连 |
| 2 | ContextInjectionMiddleware | 用户上下文注入（工厂模式隔离） |
| 3 | SkillsSyncMiddleware | 技能文件夹级增量同步 |
| 4 | UserSkillsRestoreMiddleware | 用户自定义技能恢复 |
| 5 | ToolsSummarizationMiddleware | 工具调用摘要监控 |
| 6 | MemoryUpdateMiddleware | 用户偏好自动提取 |
| 7 | SandboxCircuitBreakerMiddleware | 沙箱熔断器（三态模型） |
| 8 | ModelCallLimitMiddleware | 模型调用次数限制 |
| 9 | ToolCallLimitMiddleware | 工具调用次数限制 |

---

## 快速启动

### 方式一：Docker 一键启动（推荐）

前置要求：Docker Desktop 已启动；项目根目录存在 `.env` 并填入 `LLM_API_KEY`（本地 workbuddy2api-hub 网关已在宿主 `:8788` 启动）；可从 `.env.example` 复制。

```bash
docker compose build      # 首次构建镜像（后端 Python + 前端 Next standalone + webintel-mcp）
docker compose up -d      # 启动全部 8 个服务
docker compose ps         # 查看状态（mongo/mock-erp/mcp-server 为 healthy）
docker compose logs -f backend   # 跟踪后端日志
docker compose down       # 停止（MongoDB 数据卷保留）
docker compose down -v    # 停止并清空数据
```

浏览器访问 http://localhost:3000。

**离线演示（无需外网）**：

```bash
DEMO_MODE=true docker compose up -d
```

`DEMO_MODE=true` 下，结构化 API 工具（`fetch_*`）直接返回内置 mock 数据（与 mock-web 假数据对齐），不发起任何网络请求；webintel 闸门对浏览器兜底请求改写 host 到 `mock-web`（nginx 假页面，:8080）。backend 同时注入「当前为离线演示」系统提示词。三张指令卡（发版追踪 / 社区舆情 / 技术路线研报）可全离线跑通。

**真实模式（默认，`.env` 中 `DEMO_MODE=false`）**：白名单域名 `github.com, news.ycombinator.com, arxiv.org` 走真实外网；本机实测 arxiv.org 最快（<1s），github.com 较慢（~12s），news.ycombinator.com 可能超时。

### 方式二：本地进程手动启动

#### 环境要求

- Python 3.11+（**deepagents 必须 <0.7**，requirements.txt 已锁上界）
- Node.js 18+
- MongoDB 6.0+
- Docker Desktop（已启动）
- 本地 workbuddy2api-hub 网关（宿主 `:8788`）

#### 启动顺序

```
MongoDB → Docker 沙箱 → mock-erp(:8081) → ERP MCP(:9000) → webintel-mcp(:9002) → Backend(:8000) → Frontend(:3000)
```

各服务启动命令：

```bash
# 1. MongoDB
docker run -d --name mongodb -p 27017:27017 mongo:6.0

# 2. 沙箱容器（镜像自带中文字体，图表中文渲染依赖它）
docker compose build sandbox
docker run -d --name erp-sandbox -w /workspace myagent-sandbox:local sleep infinity

# 3. Mock ERP（首次启动自动灌入种子数据）
python -m src.mock_erp.main

# 4. ERP MCP Server（:9000）
python -m src.mcp_server.server_main

# 5. WebIntel-MCP（:9002，见外部仓 D:\桌面\Brower_Use\webintel-mcp）
#    在 webintel-mcp 仓内按其文档启动，或直接 docker compose 启动

# 6. 后端 API（:8000）
python -m src.api_view.web_main

# 7. 前端（:3000）
cd frontend && npm run dev
```

> Windows + Git Bash：若 `npm run dev` 报 `'node' 不是内部或外部命令`，改用 `node node_modules/next/dist/bin/next dev`。

---

## 项目结构

```
MyAgent/
├── frontend/                          # Next.js 前端
│   └── src/
│       ├── app/                       # App Router（page.tsx）
│       ├── components/
│       │   ├── chat/                  # 对话区（消息/输入/工具调用/阶段条）
│       │   ├── interrupt/             # HITL 审批卡 / 信息补充
│       │   ├── sidebar/               # 历史/搜索
│       │   └── trace/                 # 执行链路 Trace 面板
│       ├── hooks/                     # useChat / useSSE / useHistory
│       └── lib/                       # API / SSE 解析 / 类型定义
│
├── src/                               # Python 后端
│   ├── agent/
│   │   ├── main_agent.py              # 主入口：create_main_agent()
│   │   ├── config.py                  # 全局配置 + INTERRUPT_ON_TOOLS
│   │   ├── harness.py                 # Harness 四阶段状态机
│   │   ├── harness_config.yaml        # 阶段/评审标准 DSL
│   │   ├── backends/                  # Docker 沙箱后端（7 层防护）
│   │   ├── middlewares/               # 自定义中间件
│   │   ├── tools/                     # 自定义工具（API 采集/chart/document/download…）
│   │   ├── trace/                     # 执行链路 Trace 采集/落库
│   │   ├── subagents/                 # 子 Agent（configs/*.yaml 声明式）
│   │   └── memory/                    # 系统提示词
│   ├── api_view/                      # FastAPI Web 层（chat/history/download）
│   ├── mcp_server/                    # ERP MCP 网关（23 工具）
│   ├── mock_erp/                      # 本地 Mock ERP（FastAPI+SQLite）
│   ├── skills/                        # 技能文件
│   └── download/                      # 生成文件下载目录
│
├── docker/                            # Dockerfile（backend/frontend）+ mock-web 假页面
├── docker-compose.yml                 # 8 服务编排
├── docs/                              # PRD / 实施计划 / DEMO_GUIDE / 设计拆解
├── .env / .env.example                # 环境变量
└── requirements.txt                   # Python 依赖
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat/stream` | SSE 流式对话 |
| POST | `/api/chat/{thread_id}/resume` | 中断恢复 |
| GET | `/api/chat/{thread_id}/state` | 获取中断状态 |
| GET | `/api/chat/{thread_id}/history` | 获取消息历史 |
| GET | `/api/chat/{thread_id}/trace/runs` | 会话执行链路 run 列表 |
| GET | `/api/chat/{thread_id}/trace` | 单次 run 的完整链路 |
| GET | `/api/history/{user_id}` | 获取会话列表 |
| DELETE | `/api/history/{thread_id}` | 删除会话 |
| GET | `/api/download/{filename}` | 下载沙箱生成文件 |
| GET | `/health` | 健康检查 |

---

## 项目亮点

1. **采集双通道**：结构化 API 优先（三域 httpx 直连，秒级返回）+ 自研 Playwright-MCP 兜底（五重安全闸门：scheme → DNS → SSRF/私有 IP → 域名白名单 → 限速）。
2. **主子 Agent 架构防上下文污染**：原始数据由 ecosystem-crawler 消化提纯，主 Agent 只见纯净 Markdown/JSON。
3. **Harness 状态机 + Rubric 硬校验**：拒绝大模型幻觉，来源 URL 与数据真实性不达标自动打回重做。
4. **HITL 双层闸门**：UI 审批卡 + MCP 域名拦截，双重合规。
5. **全链路可视化 Trace**：`agent_traces` 落库，精确追溯每次 MCP 调用耗时、DOM 提取字符数、token 归因。
6. **离线演示防挂**：`DEMO_MODE=true` 无缝路由到内置 nginx mock 站点，面试演示不受网络代理影响。
7. **MongoDB 全链路持久化**：MongoDBSaver（checkpoint）+ MongoDBStore（偏好）+ display_messages + conversations + agent_traces。
8. **YAML 声明式子 Agent**：工具集/提示词/委派协议/中断策略全配置化，改流程不改代码。

---

## 第二业务域：ERP 采购（骨架复用验证）

本项目骨架最初为电子元器件采购助手构建，改造为技术情报 Agent 后，ERP 采购域作为**第二业务域**保留，用于验证「Agent 骨架 + Harness + HITL + MCP + 沙箱」的可复用性：

- `procurement-analyst` / `procurement-order` 子 Agent（`src/agent/subagents/configs/*.yaml`）
- ERP MCP Server（`src/mcp_server/`，23 个采购工具）
- Mock ERP（`src/mock_erp/`，FastAPI + SQLite，契约见 `src/mock_erp/CONTRACT.md`）

接入真实 ERP 只需修改 `ERP_BASE_URL`，Agent 与 MCP 层零改动。两个业务域共享同一套 Harness 流程、HITL 中断、沙箱与 Trace 基础设施。

---

## 开发说明

- 修改 Agent 行为：编辑 `src/agent/memory/prompts.py`（系统提示词）
- 修改评审标准：编辑 `src/agent/harness_config.yaml`（rubrics）
- 添加新工具：在 `src/agent/tools/` 创建，在 `main_agent.py` 注册
- 修改子 Agent：编辑 `src/agent/subagents/configs/*.yaml`
- 中断注册：`src/agent/config.py` 的 `INTERRUPT_ON_TOOLS`
- 离线演示开关：`.env` 的 `DEMO_MODE`（webintel 与 backend 双开关）
- 采集白名单：`.env` 的 `CRAWL_ALLOW_DOMAINS`（改后需 `docker compose restart webintel-mcp`）
