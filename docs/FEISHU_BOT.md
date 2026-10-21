# 飞书机器人对接文档

把「竞品投放监测」的能力开放给团队：在飞书里 @ 机器人（或单聊）一句话，就能查总览、复投账号、对比竞品、拉 Excel，管理员还能直接发起抓取。

> **状态**：内核、指令、权限、限流、两种接入方式、提醒推送均已实现并有 90+ 个自动化测试覆盖（飞书 API 用 mock）。**尚未用真实飞书租户联调**——第一次接入时请按文末「联调清单」走一遍。

---

## 1. 架构

```
                         ┌──────────── 飞书 ────────────┐
                         │  用户 @机器人 / 单聊          │
                         └──────┬─────────────▲─────────┘
        长连接 WebSocket(推荐本机)│             │ 发送消息/卡片/文件
        或 Webhook(需公网 HTTPS) │             │
                         ┌──────▼─────────────┴─────────┐
 scripts/feishu-bot.ts   │  事件适配 events.ts           │  ← 去重 · 群聊仅@响应 · 授权 · 限流
 /api/feishu/events      │  指令层 commands.ts           │  ← 解析 → 权限 → 执行 → Reply
                         │  卡片 cards.ts / 客户端 feishu.ts │
                         └──────┬───────────────────────┘
                 读：直接调用    │   写(会计费)：BotBackend
        queries / export / alerts│   direct(同进程) 或 http(转给 Web)
                         ┌──────▼───────────────────────┐
                         │  现有 Web 应用 + SQLite       │  ← 唯一持有 TikHub 限速/熔断/预算
                         └──────────────────────────────┘
```

设计原则：

1. **机器人不复制业务逻辑**。所有指令只调用现有的 `queries.ts` / `export.ts` / `alerts.ts`，所以网页与机器人口径永远一致（去重、复投阈值、分层、人工否决都生效）。
2. **传输层可替换**。内核只依赖 `Sender` 接口，飞书只是实现之一；换企业微信 / 钉钉 / Slack 只需新增一个 `Sender` 和事件适配。
3. **计费动作只有一个出口**。会消耗 TikHub 调用的「抓取」走 `BotBackend`：同进程时直接调用，独立进程时通过 HTTP 转给 Web 应用，保证限速（3 QPS）、熔断、每日预算只在一个进程里维护，不会因为多开进程而翻倍。
4. **默认拒绝**。未授权的人只会收到自己的 `open_id`，不会执行任何指令。

## 2. 功能映射

| Web 功能 | 飞书指令 | 角色 | 状态 |
|---|---|---|---|
| 总览看板 | `总览` | 成员 | ✅ |
| 竞品列表 / 详情 | `竞品` · `竞品 LibTV` | 成员 | ✅ |
| 发起抓取（含预估调用量、预算校验） | `抓取 LibTV 近30天` | 管理员 | ✅ 完成后自动推送结果卡片 |
| 任务历史 / 状态 | `任务` · `任务 12` | 成员 | ✅ |
| 高频复投账号 | `复投` · `复投 LibTV` | 成员 | ✅ |
| 本周新增账号 | `新增` · `新增 LibTV` | 成员 | ✅ |
| 账号搜索 | `账号 关键词` | 成员 | ✅ |
| 竞品对比（共同 KOL） | `对比 LibTV 即梦AI` | 成员 | ✅ |
| 导出 Excel | `导出 账号 LibTV` · `导出 报告 LibTV` | 成员 | ✅ 以文件消息发送 |
| 调用监控 | `用量` | 成员 | ✅ |
| 提醒中心 | `提醒` | 成员 | ✅ |
| 提醒主动推送 | `订阅` · `退订` | 管理员 | ✅ 新增复投 / 任务完成 / 预算告警 / 任务失败 |
| 任务前后对比（A vs B） | — | — | 🔲 预留（见 §8） |
| 账号状态 / 标签 / 备注 / 否决作品 | — | — | 🔲 预留：需要卡片按钮回调 |
| 规则与设置、竞品增删改、定时监控 | — | — | ⛔ 有意不开放：影响口径与成本，保留在 Web 端 |

除了固定指令，也可以**直接说人话**（见 §8 意图层）：「libtv 最近有啥新账号」「对比一下 LibTV 和可灵」「把即梦的报告导出来」「帮我重新抓一下可灵近 7 天」。

群里需要 **@机器人** 才会响应（避免刷屏）；单聊直接发即可。指令支持别名（如 `help`、`run`、`repeat`），时间可写 `近30天` / `7天` / `一周` / `半年`。

## 3. 权限与安全模型

| 角色 | 如何获得 | 能做什么 |
|---|---|---|
| 管理员 | `open_id` 在 `FEISHU_ADMIN_OPEN_IDS` | 全部，包括 `抓取`、`订阅` |
| 成员 | `open_id` 在 `FEISHU_ALLOWED_USERS`，**或**消息所在群在 `FEISHU_ALLOWED_CHATS` | 只读查询、导出 |
| 无权限 | 其他人 | 仅收到自己的 `open_id`，方便找管理员授权 |

- **授权流程**：新同事 @ 机器人 → 收到自己的 `open_id` → 发给管理员 → 管理员加进环境变量并重启。
- **限流**：每人每分钟 20 条；管理员每人每小时最多 5 次 `抓取`。
- **费用护栏**：抓取前复用 Web 端同一套预估与每日预算校验，超预算直接拒绝；TikHub 的熔断同样生效。
- **事件校验**：webhook 校验 Verification Token（常量时间比较），支持 Encrypt Key（AES-256-CBC）；缺少 token 时拒绝服务（503）。长连接模式由飞书 SDK 鉴权，无需公网入口。
- **密钥**：`FEISHU_APP_SECRET` 等只放 `.env`，不进代码库、不写日志、不通过任何接口返回。
- **注意**：机器人返回的是业务数据（账号、粉丝、作品链接）。把它拉进群前，确认群成员都应当能看到这些内容；需要更严的范围就用 `FEISHU_ALLOWED_USERS` 而不是 `FEISHU_ALLOWED_CHATS`。

## 4. 在飞书开放平台配置

1. 打开 [飞书开放平台](https://open.feishu.cn/app)（国际版 Lark 用 open.larksuite.com，并设置 `FEISHU_BASE_URL`）→ **创建企业自建应用**。
2. **添加应用能力 → 机器人**。
3. **权限管理**，开通（名称以平台页面为准）：
   - 获取与发送单聊、群组消息 / 以应用的身份发消息（`im:message`、`im:message:send_as_bot`）
   - 接收群聊中 @ 机器人的消息（`im:message.group_at_msg:readonly`）
   - 读取用户发给机器人的单聊消息（`im:message.p2p_msg:readonly`）
   - 上传、下载文件（`im:resource`）—— 仅「导出」需要
4. **事件与回调 → 事件配置**：订阅 `im.message.receive_v1`（接收消息）。订阅方式二选一：
   - **使用长连接接收事件（推荐，本机/内网首选）**：无需公网地址。
   - **将事件发送至开发者服务器**：填请求地址 `https://你的域名/api/feishu/events`，并记下页面上的 **Verification Token**（以及可选的 **Encrypt Key**）。
5. **凭证与基础信息**：复制 `App ID`、`App Secret`。
6. **版本管理与发布**：创建版本并发布（企业内部应用通常自动通过，或由管理员审批）。**每次改权限/事件都要重新发布才生效。**
7. 在飞书里搜索机器人名称单聊，或把它拉进群。

## 5. 部署

### 5.1 环境变量

复制 `.env.example` 里的「飞书机器人」段到 `.env`：

| 变量 | 必填 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | ✅ | 应用凭证 |
| `FEISHU_ADMIN_OPEN_IDS` | ✅（至少一人） | 管理员，逗号分隔 |
| `FEISHU_ALLOWED_USERS` / `FEISHU_ALLOWED_CHATS` | 可选 | 成员名单 / 允许的群 `chat_id` |
| `FEISHU_VERIFICATION_TOKEN` | webhook 必填 | 事件订阅页的 Verification Token |
| `FEISHU_ENCRYPT_KEY` | webhook 可选 | 开启了事件加密时必填 |
| `FEISHU_BASE_URL` | 可选 | 默认 `https://open.feishu.cn`；Lark 国际版填 `https://open.larksuite.com` |
| `FEISHU_MODE` | 可选 | `webhook`：Web 进程内顺带推送提醒；默认长连接由 `pnpm bot` 负责 |
| `FEISHU_PUSH_ALERTS` | 可选 | 设 `0` 关闭主动提醒推送 |
| `BOT_AGENT` | 可选 | 意图层模式：`rules`（默认）/ `llm` / `off`，见 §8 |
| `BOT_LLM_PROVIDER` | 可选 | `deepseek`（默认）/ `anthropic` / `openai`（任意 OpenAI 兼容） |
| `DEEPSEEK_API_KEY` | `llm` 模式必填 | DeepSeek 密钥，只放 `.env`，**不要**进代码库 |
| `BOT_LLM_MODEL` | 可选 | 默认 `deepseek-flash`；也可 `deepseek-v4-pro` 等 |
| `BOT_LLM_DAILY_CAP` | 可选 | 每日智能解析次数上限，默认 200 |
| `APP_BASE_URL` | 长连接 | `pnpm bot` 访问 Web 应用的地址，默认 `http://127.0.0.1:3111` |
| `APP_PUBLIC_URL` | 推荐 | 卡片里「查看详情」按钮的链接，需要让同事能打开（内网域名/IP 均可） |

### 5.2 方案 A：长连接（本机或内网服务器，推荐）

不需要公网 IP、域名、HTTPS。需要**两个进程**（共用同一个 `data/gtm.db`）：

```bash
pnpm build && pnpm start -p 3111   # Web 应用（持有 TikHub 限速/调度）
pnpm bot                           # 飞书长连接机器人
```

常驻运行（任选其一）：

```bash
# pm2
pm2 start "pnpm start -p 3111" --name gtm-web
pm2 start "pnpm bot"          --name gtm-bot
pm2 save && pm2 startup
```

```ini
# systemd: /etc/systemd/system/gtm-bot.service（gtm-web 同理，ExecStart 换成 pnpm start -p 3111）
[Service]
WorkingDirectory=/opt/gtm-swim
ExecStart=/usr/bin/env pnpm bot
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

> macOS 本机可用 `launchd`，或直接开两个终端。机器休眠/断网时机器人离线，恢复后 SDK 会自动重连。

### 5.3 方案 B：Webhook（有公网 HTTPS 的服务器）

只需要 Web 进程；机器人与 Web 同进程（`BotBackend` 为 `direct`）。

1. 在 `.env` 设置 `FEISHU_VERIFICATION_TOKEN`（可选 `FEISHU_ENCRYPT_KEY`）与 `FEISHU_MODE=webhook`。
2. 反向代理（Nginx/Caddy）把 `https://你的域名/api/feishu/events` 转到 Web 应用。
3. 在开放平台填入请求地址，点击保存——飞书会发 `url_verification`，路由会校验 token 并返回 `challenge`。
4. 飞书要求 3 秒内响应；路由先返回 200，再后台处理（指令耗时不影响 ack，飞书也不会因超时重试）。

### 5.4 数据与备份

- 数据都在 `data/gtm.db`（SQLite，WAL 模式），备份时一并拷走 `-wal`/`-shm`，或先 `sqlite3 data/gtm.db ".backup backup.db"`。
- 两个进程同时读写同一个 SQLite 是安全的（WAL）；写入量很小。
- 长连接机器人**不会**自己跑抓取，只读库 + 经 HTTP 让 Web 应用跑，所以 Web 应用必须在运行。

## 6. 指令参考

```text
帮助                     查看指令（按角色显示）
总览                     各竞品账号数 / 复投数 / 本周新增
竞品                     竞品列表
竞品 LibTV               详情：监测词、层级分布、复投 Top、最近任务、定时监控
抓取 LibTV 近30天        [管理员] 发起抓取；完成后自动推送结果卡片
任务  /  任务 12         最近任务 / 指定任务状态与进度
复投 [LibTV]             高频复投账号 Top10
新增 [LibTV]             近 7 天首次发现的账号
账号 关键词              按名称/UID/备注搜索
对比 LibTV 即梦AI        共同 KOL 与各自独占数
导出 账号 LibTV          发送 Excel（账号列表）
导出 报告 LibTV          发送 Excel（监测报告，多工作表）
用量                     今日 API 调用 / 预算 / 缓存命中率
提醒                     最近提醒
订阅 / 退订              [管理员] 本会话是否接收主动提醒推送
```

竞品名支持不区分大小写与包含匹配；若匹配到多个会列出候选并要求写全名。

## 7. 接口契约（扩展与移植）

全部在 `src/lib/bot/`，类型见 `types.ts`。

### 7.1 `Sender` —— 传输层抽象

```ts
interface Sender {
  text(chatId: string, text: string, replyTo?: string): Promise<void>;
  card(chatId: string, card: Card, replyTo?: string): Promise<void>;
  file(chatId: string, name: string, data: Buffer, replyTo?: string): Promise<void>;
}
```

`FeishuClient` 是飞书实现（自动换取并缓存 `tenant_access_token`，群里用「回复」接口保持上下文）。移植到企业微信/钉钉：实现这三个方法 + 写一个事件适配（把平台消息转成 `MessageEvent` 调 `handleMessageEvent`）。

### 7.2 `BotBackend` —— 计费动作的出口

```ts
interface BotBackend {
  runCompetitor(competitorId: number, days: number): Promise<{ id: number; estimate: number }>; // 失败抛 Error(可读信息)
}
```

`directBackend`（同进程，含预算校验）与 `httpBackend(baseUrl)`（POST `/api/competitors/:id/run`）。**以后新增任何会触发 TikHub 的指令，都应加到这个接口里**，不要在机器人进程里直接调 `createTask`。

### 7.3 `Command` —— 新增一条指令

在 `commands.ts` 的 `COMMANDS` 里加一项即可：

```ts
{
  names: ["简报", "digest"], usage: "简报 [竞品名]", desc: "…", role: "member" | "admin",
  run: async (args, ctx) => ({ card: card("标题", "blue", ["**markdown** 内容"], { links: [...] }) }),
}
```

`Reply` 可以是 `{ text }`、`{ card }`、`{ file: { name, data } }`；权限、限流、群聊 @ 判断、异常兜底、`帮助` 里的展示都由框架处理。读数据请调用 `queries.ts` 的现成函数。

### 7.4 意图层与 `IntentResolver`

自然语言能力已在 **§8 意图层** 实现（`src/lib/bot/agent/`），由 `BOT_AGENT` 开关控制，默认启用规则解析。

`dispatch(text, ctx, resolve?)` 上还保留一个更底层的 `IntentResolver` 钩子，用于你想**完全自定义**"一句话 → 指令"的场景：

```ts
type IntentResolver = (text: string, ctx: BotCtx) => Promise<{ name: string; args: string[] } | null>;
```

两者的共同约束：产出的只能是「指令名 + 参数」，**之后必须走同一个 `runCommand`**——权限、限流、预算护栏不变，LLM 不能绕过它们，也不应被授予直接查库/发请求的能力。

### 7.5 事件适配

`handleMessageEvent(event, deps)` 接收飞书 `im.message.receive_v1` 的事件体（长连接与 webhook 的结构一致），依次做：忽略机器人自己 → 事件去重（飞书会重试） → 群聊仅 @ 响应 → 授权 → 非文本提示 → 限流 → 已知指令直接执行 / 否则进入意图层（确认·取消·自然语言） → 发送。`deps.botOpenId()` 用于精确判断「@ 的是不是我」（`GET /bot/v3/info`），取不到时退化为「有人被 @ 即响应」。

## 8. 意图层（Agent）：让用户直接说人话

目标：用户不用记指令，一句话说清诉求，机器人先**理解意图**，再**调用现有的竞品调研能力**（查结果、导出、发起抓取）。它是在指令层之上的一层薄封装，**不新增任何业务能力、不绕过任何保护**。

### 8.1 处理流程

```
用户一句话
   │ 是已知指令（如「复投 LibTV」）？ ──是──► 指令层，直接执行（最快、零成本）
   │ 否
   ├─ 是「确认 / 取消」且有待确认动作？ ──► 执行 / 放弃待确认的抓取
   ▼
 ① 规则解析（默认，免费、离线、可预测）  ── 命中 ─┐
   │ 未命中且 BOT_AGENT=llm                       │
 ② 大模型解析（默认 DeepSeek，输出"工具调用+参数"）── ───┤
   │ 都没理解 → 「没听懂，发送『帮助』」          ▼
                                    计划 Plan = { 工具调用[≤3], 或 追问一句话 }
                                                  │
                    校验：工具白名单 · 参数 schema · 竞品名必须存在 · 角色权限
                                                  │
        查询/导出类 ──► 复用现有指令执行（卡片/文件）
        抓取(计费)类 ──► 只"提议"：显示预估调用量，等用户回复「确认」才真正发起
```

回复里会先给一行「🤖 理解为：新增 LibTV」，让用户知道机器人怎么理解的，理解错了可以立刻纠正。

### 8.2 三种模式（`BOT_AGENT`）

| 模式 | 行为 | 成本 |
|---|---|---|
| `rules`（默认） | 只用规则解析，覆盖常见说法，没命中就回「没听懂」 | 免费 |
| `llm` | 规则没命中时，再让大模型（默认 DeepSeek）解析；**规则命中的永远不调模型** | 每次未命中约一次小模型调用，受每日上限限制 |
| `off` | 关闭，只认固定指令 | 无 |

规则覆盖的说法示例：

| 你说 | 理解为 |
|---|---|
| libtv 最近有啥新账号 | `新增 LibTV` |
| 哪些账号被反复投放 / 看看即梦AI的复投达人 | `复投` / `复投 即梦AI` |
| 对比一下 LibTV 和可灵 / 可灵和 libtv 比比 | `对比 LibTV 可灵` |
| 导出 LibTV 账号表格 / 把可灵的报告导出来 | `导出 账号 LibTV` / `导出 报告 可灵` |
| 重新抓一下 libtv 近 7 天 / 帮我跑一下可灵 | `抓取 LibTV 7天`（需确认） |
| 任务 12 跑完了吗 / 今天花了多少预算 | `任务 12` / `用量` |
| 整体情况怎么样 / LibTV 怎么样 | `总览` / `竞品 LibTV` |

信息不足时**追问而不是猜**：「导出报告」→「导出哪个竞品？现有：LibTV、即梦AI…」。

### 8.3 为什么这样设计（安全边界）

1. **模型只"选工具"，不"做事"**。它的输出只是「调用哪个工具、参数是什么」，之后全部经过与文本指令完全相同的校验、权限、限流、预算与熔断。模型被诱导也越不了权。
2. **模型看不到不可信数据**。发给模型的只有：用户这一句话 + 管理员创建的竞品名单（含监测词）。**抓取回来的账号名、作品标题、评论等不可信文本永远不进提示词**，所以爬来的内容无法对模型做提示注入。（测试里专门断言了这一点。）
3. **会花钱的动作必须二次确认**。无论规则还是模型提出「抓取」，都只生成一条待确认提议（含预估调用量），**用户回复「确认」才执行**；5 分钟有效、仅发起人本人可确认、执行时再校验一次管理员身份、并计入「每人每小时 5 次」上限。成员即使被模型诱导出 `run_crawl` 也会被拒绝，且不会产生待确认项。
4. **只暴露白名单工具**。成员的请求里不会带上 `run_crawl` 工具定义；模型编造的工具名、竞品名会被忽略或报「找不到竞品」。
5. **成本护栏**：规则优先（命中不调模型）、每人每分钟最多 10 次意图解析、全局每日上限（`BOT_LLM_DAILY_CAP`，默认 200）、请求 15 秒超时、失败自动回落为「没听懂」。
6. **直接固定指令永远优先**，且不经过模型——网络或模型不可用时，机器人照常工作。

### 8.4 工具清单

工具在 `src/lib/bot/agent/tools.ts` **声明一次**（名称、描述、JSON Schema、角色、是否计费、如何映射到现有指令），规则解析和大模型共用。

| 工具 | 映射 | 角色 | 计费 |
|---|---|---|---|
| `overview` / `list_competitors` / `competitor_detail` | 总览 / 竞品 | 成员 | — |
| `repeat_accounts` / `new_accounts` / `search_accounts` | 复投 / 新增 / 账号 | 成员 | — |
| `compare_competitors` | 对比 | 成员 | — |
| `list_tasks` / `usage` / `alerts` | 任务 / 用量 / 提醒 | 成员 | — |
| `export_excel` | 导出 | 成员 | — |
| `run_crawl` | 抓取 | 管理员 | ✅ 需确认 |

### 8.5 启用大模型解析（默认 DeepSeek）

```bash
# .env
BOT_AGENT=llm
DEEPSEEK_API_KEY=sk-...            # 只放 .env，不要进代码库、不要发到群里
# 以下均可选
BOT_LLM_MODEL=deepseek-flash       # 默认；意图分类用它足够，也可换 deepseek-v4-pro
DEEPSEEK_BASE_URL=                 # 默认 https://api.deepseek.com；走网关时填
BOT_LLM_DAILY_CAP=200
```

重启机器人（长连接模式重启 `pnpm bot`，webhook 模式重启 Web 应用）。

实现要点（已按 DeepSeek 官方文档核对）：

- 接口：OpenAI 兼容的 `POST {base}/chat/completions`，`Authorization: Bearer <key>`，用 `tools`（function 格式）+ `tool_choice: "auto"`。
- **显式关闭思考模式**（`thinking: {type: "disabled"}`）：DeepSeek 默认开启思考，会增加延迟和 token 费用，而意图分类不需要；同时 `temperature: 0` 让输出更稳定。
- 官方提醒模型可能生成**非法 JSON 参数**，所以所有 `arguments` 都做 `JSON.parse` 校验，非法的直接忽略；之后还要过工具 schema 与竞品名校验。
- key 只出现在请求头，不会进入提示词或日志。

切换提供方（`BOT_LLM_PROVIDER`）：

| 提供方 | 必填变量 | 默认模型 |
|---|---|---|
| `deepseek`（默认） | `DEEPSEEK_API_KEY` | `deepseek-flash` |
| `anthropic`（Claude） | `ANTHROPIC_API_KEY`（可选 `ANTHROPIC_BASE_URL`） | `claude-haiku-5-5` |
| `openai`（任意 OpenAI 兼容） | `BOT_LLM_API_KEY` + `BOT_LLM_BASE_URL`（含 `/v1`）+ `BOT_LLM_MODEL` | 无，必须指定 |

若机器所在网络无法直连所选服务，用对应的 `*_BASE_URL` 指向你的网关。

### 8.6 扩展

- **新增一个工具**：在 `tools.ts` 的 `TOOLS` 里加一项（`toCommand` 映射到已有指令），并在 `rules.ts` 里按需加几条规则；大模型自动获得该工具。如果它会计费，设 `billed: true`，框架自动走确认流程。
- **接入别的 Agent 网关 / MCP**（如 OpenClaw 这类通用 Agent 框架）：工具表本身就是「名称 + 描述 + JSON Schema」，转成 MCP `tools/list` 的格式即可对外暴露；**执行仍须经过 `runCommand`**（权限）和 `BotBackend`（计费确认），不要让外部 Agent 直连数据库或 `createTask`。
- **换模型/换厂商**：OpenAI 兼容的服务直接用 `BOT_LLM_PROVIDER=openai` 配置即可；协议不同的厂商，在 `agent/llm.ts` 里仿照 `callOpenAICompatible` 加一个调用函数（输入：用户句子、竞品名单、角色、工具表；输出：文本 + 工具调用）。
- **多轮对话**：目前每句话独立解析，只有「确认/取消」是有状态的。要支持「再看看可灵的」这类指代，需要在 `engine.ts` 里保存每个会话最近一次的竞品/工具作为上下文（预留，未实现）。

## 9. 预留与路线图

以下能力的接口位已经留好，但**未实现**：

| 能力 | 做法 | 备注 |
|---|---|---|
| **卡片按钮回调** | 订阅 `card.action.trigger`；卡片里放 `callback` 按钮，把 `{cmd,args}` 放进 `value`，回调里走同一个 `runCommand` | 解锁：账号标注（关注/已联系）、一键否决作品，以及用按钮代替文字「确认/取消」 |
| **审批式抓取** | 成员提出抓取 → 给管理员发带「同意/拒绝」按钮的卡片 → 同意后调 `backend.runCompetitor` | 依赖卡片回调；意图层的待确认机制可直接复用 |
| **多轮上下文** | 意图层按会话缓存最近的竞品/工具，支持「那可灵呢」 | 见 §8.6 |
| **定时简报** | 复用 `scheduler.ts`：每周一 9:00 给订阅会话发 `总览` + `新增` 卡片 | 只需新增 cron 与推送目标 |
| **任务前后对比** | 新增 `对比任务 12 15` 指令（及工具），调用 `compareTasks` | 数据层已有 |
| **订阅粒度** | `bot_subs` 增加 `kind`/`competitor_id` 列，推送时按竞品过滤 | 现在是"本会话收全部提醒" |
| **多维表格** | 抓取完成后把账号表同步到飞书多维表格（Bitable API） | 适合运营协作标注 |
| **消息卡片 2.0 / 表格组件** | 替换 `cards.ts` 的 markdown 列表 | 目前用 1.0 结构，兼容性最好 |

## 10. 已知限制

- 卡片正文用 markdown 列表而非表格；每张卡最多列 10 项（飞书卡片上限约 30KB）。
- `订阅` 是按会话整体订阅，暂不支持按竞品订阅。
- 通知依赖进程存活：长连接机器人或 Web 进程退出期间产生的提醒，会在恢复后的下一轮推送补发（以 `bot_last_alert_id` 为水位）；任务完成的主动通知（`watchTask`）是内存里的轮询，进程重启后不会续推，需要用 `任务 <编号>` 手动查。
- 机器人进程不做抓取调度；定时监控仍由 Web 进程内的调度器负责。
- PDF 导出依赖本机 Chrome，所以机器人只提供 Excel。
- 意图层：规则只覆盖常见中文说法，可能有误判（所以回复里总会先展示「理解为…」）；待确认动作和大模型每日计数都存在进程内存里，重启即清空；`llm` 模式未经真实 DeepSeek 接口联调（请求/解析由按官方文档构造的 mock 测试覆盖）。

## 11. 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 机器人完全不回复 | 看进程日志；确认已发布应用版本；单聊要有 `p2p_msg` 权限，群聊要有 `group_at_msg` 权限且**确实 @ 了机器人** |
| 回复「你还没有使用权限」 | 正常的默认拒绝。把回复里的 `open_id` 加进 `FEISHU_ALLOWED_USERS` / `FEISHU_ADMIN_OPEN_IDS` 后重启 |
| 回复「仅管理员可用」 | 该指令会计费，需要在 `FEISHU_ADMIN_OPEN_IDS` 里 |
| 说人话没反应 / 总是「没听懂」 | 检查 `BOT_AGENT` 不是 `off`；规则覆盖不到的说法需要 `BOT_AGENT=llm`；或直接用固定指令 |
| `llm` 模式没效果 | 日志里搜 `[bot] llm`：`http 401` = key 不对；`402` = 余额不足；`timeout` = 网络不通，设 `DEEPSEEK_BASE_URL`；「工具参数不是合法 JSON」= 模型偶发输出，已自动忽略；提示「额度已用完」= 触达 `BOT_LLM_DAILY_CAP`。还要确认 `BOT_LLM_PROVIDER` 与所填的 key 对应 |
| 说了「帮我抓取…」没有执行 | 正常：需要再回复「确认」；5 分钟内有效，且只有发起人本人能确认 |
| 「出错了：Web 应用返回 …」/「连不上 Web 应用」 | 长连接模式下 Web 应用没启动，或 `APP_BASE_URL` 不对 |
| 「出错了：…超出预算」 | 今日 TikHub 调用已达 `TIKHUB_DAILY_BUDGET_CALLS`，调大或次日再试 |
| webhook 保存地址失败 | 地址不可公网访问 / token 不一致 / 3 秒内未响应；`curl -XPOST` 自测 `url_verification` |
| 收到 503「机器人未配置」 | 缺 `FEISHU_VERIFICATION_TOKEN`（或缺 `FEISHU_APP_ID/SECRET`） |
| 「飞书接口错误 99991672」等权限类 | 在开放平台为应用补权限并**重新发布版本** |
| 导出文件发不出去 | 缺 `im:resource` 权限；或企业对机器人发文件有限制 |
| 卡片里的链接打不开 | `APP_PUBLIC_URL` 还是 localhost，改成同事能访问的地址 |
| 访问 TikHub 超时 | 见主 README：配置 `TIKHUB_PROXY`（与飞书机器人无关，由 Web 进程负责） |

## 12. 联调清单（第一次接入照着做）

- [ ] `pnpm test` 全绿；Web 应用 `pnpm start` 正常
- [ ] 开放平台：机器人能力、权限、事件 `im.message.receive_v1`、发布版本
- [ ] `.env` 填好 `FEISHU_APP_ID/SECRET`、`FEISHU_ADMIN_OPEN_IDS`（先随便填，下一步拿到真实 `open_id` 再改）
- [ ] 长连接：`pnpm bot` 日志出现已连接；webhook：保存请求地址通过
- [ ] 单聊发「帮助」→ 收到 open_id 指引 → 加入管理员 → 重启 → 再发「帮助」收到卡片
- [ ] 发「总览」「竞品」「复投」确认数据与网页一致
- [ ] 发「导出 账号 <竞品>」确认能收到 xlsx
- [ ] 说人话：「<竞品> 最近有啥新账号」→ 先看到「🤖 理解为…」再看到结果
- [ ] 说「帮我抓一下 <竞品> 近 7 天」→ 只收到确认提示、此时 TikHub 无新增调用；回复「确认」后才发起
- [ ] （可选）`BOT_AGENT=llm` 并配好 `DEEPSEEK_API_KEY`：说一句规则覆盖不到的话（如「盘一盘最近的局势」），确认能被理解；日志里 `[bot] llm` 无报错；确认 DeepSeek 控制台有对应的调用记录且 token 很少（思考模式已关闭）
- [ ] 把机器人拉进群：不 @ 不响应；@ 后响应
- [ ] 管理员发「抓取 <竞品> 近7天」→ 收到"已发起" → 完成后收到结果卡片（注意会消耗少量 TikHub 调用）
- [ ] 管理员发「订阅」，在网页触发一次抓取，确认群里收到提醒推送

## 13. 测试覆盖

- `tests/bot.test.ts`（29 项）：指令解析与别名、天数解析、竞品模糊匹配；所有指令返回合法卡片且 < 30KB；复投/对比结果正确；导出产出有效 xlsx；成员/管理员权限边界；默认拒绝并回传 open_id；群聊仅 @ 响应（含 @ 别人）；事件去重；机器人自发消息与非文本；限流；异常兜底；任务完成推送；提醒推送水位；飞书客户端（token 缓存、发送/回复/上传、错误）；webhook 的 url_verification、token 校验、加密事件解密、未配置与非法请求。
- `tests/agent.test.ts`（46 项）：规则意图（20+ 种说法、追问、无关内容、较长竞品名优先、时间表达）；工具 schema 与参数校验；查询/导出直通；**抓取必须确认**（成员被拒、确认一次性、取消、5 分钟超时、他人不能代确认、权限以确认时为准）；大模型请求（默认提供方 DeepSeek 的地址/模型/鉴权/`thinking` 关闭/function tools 格式、提供方切换与配置校验、只含用户句子与竞品名单、**不含任何抓取内容**、key 不进请求体、成员不带 `run_crawl` 工具、非法 JSON 参数被忽略、纯文本当追问、HTTP/超时回落、每日上限、规则命中不调模型；Anthropic 与通用 OpenAI 兼容协议同样覆盖）；模型越权与幻觉（成员被诱导抓取被拒、编造工具/竞品被忽略）；飞书事件接入（「理解为」、确认流程、意图层限流、确认计入每小时 5 次上限、`BOT_AGENT=off`）。

---

## 14. 智能升级（多轮上下文 · 解读 · 修改类操作 · 周报 · 成本与交互）

> 在第 8 章的意图层之上做的一次升级。**关键约束没变**：模型永远不能绕过权限 / 限流 / 预算 / 二次确认。

### 14.1 两段式：规划带工具，解读不带工具

```
用户一句话 ─► 规划 llmPlan   输入：这句话 + 近几轮"理解为" + 竞品名单      有工具   ─► 工具调用
                                   （绝不含抓取内容）
          ─► 代码执行工具（权限/限流/确认）─► 卡片 + 紧凑结构化数据
          ─► 解读 llmAnalyze  输入：问题 + <data>查询结果</data>             无工具   ─► 几句话结论
                                   （含不可信文本，但没有任何工具可调；输出再剥掉链接与 @）
```

- 规则能认出要什么数据、又听出“为什么/怎么看/建议”时，规划这一步省掉，**只花 1 次模型调用**。
- 解读结果里的账号名 / 标题经 `clean()` 净化并截短；模型输出过 `sanitizeOut()`，去掉链接和 `<at>`/`@all`。
- 会话历史只存【用户原话】和【我们自己生成的“理解为…”】，不存模型基于抓取数据写出的文字。

### 14.2 多轮上下文
`bot_sessions` 表，按 `会话:用户`，最近 6 轮 + “最近讨论的竞品”，2 小时过期。规则路径也能用（“那它的新增呢”不花钱）。

### 14.3 修改类操作（管理员，先复述再确认）
新增竞品（`add_competitor`）、改监测词（`update_keywords`）、标记账号（`tag_account`）、抓取（`run_crawl`）。
模型只能**提议**，提议落库 `bot_pending`（5 分钟，一人一个），回复「确认」才执行，**权限在确认那一刻重新校验**。缺关键词/平台时先追问，不替用户编造。
周报开关、订阅属于无计费、可逆的设置，管理员说了立即生效。

### 14.4 周报
`BOT_DIGEST=mon@9`，或管理员对机器人说“开启周报每周五 17 点”。推给 `订阅` 过的会话；每周只发一次（ISO 周号落库），
机器人晚于设定时间启动，当天仍会补发。卡片数字全部由查询生成，模型只加最上面的“要点”，失败/超额时周报照发。任何人可以随时问“这周的周报”。

### 14.5 DeepSeek 思考模式
| `BOT_LLM_THINKING` | 规划 | 解读 |
|---|---|---|
| `off`（默认） | 关 | 关 |
| `analysis`（推荐） | 关 | **开** |
| `all` | 开 | 开 |

`BOT_LLM_REASONING_EFFORT=low|high|max`；`BOT_LLM_ANALYSIS_MODEL=deepseek-v4-pro` 可让解读单独用更强的模型。
开启后：请求带 `thinking:{type:"enabled"}` + `reasoning_effort`，不再发 `temperature`，`max_tokens` 放大到 ≥8000（推理 token 计入其中），超时放宽到 60 秒。
`reasoning_content` 不读取、不存储；因为解读调用没有工具、规划也不会把工具结果回喂给模型，不需要按官方“带工具时必须回传 reasoning_content”的规则处理多轮。

### 14.6 成本
- 额度落库（`bot_llm_usage`，按天按人）：全员调用数、每人调用数、全员 token 三道闸；`用量` 指令能看到今日调用与 token、输入缓存命中。
- 同一份数据 + 同一个问题，30 分钟内复用上次解读。
- 规则优先；提示词前缀稳定（静态规则 → 竞品名单 → 日期），便于 DeepSeek 等按前缀自动做上下文缓存。

### 14.7 交互
需要等模型时，先发一张“🤖 处理中”占位卡（`config.update_multi=true`），随后通过 `PATCH /im/v1/messages/:id` 原地刷新：理解中 → 查询中 → 分析中 → 最终答案；详情卡片作为新消息跟在后面。
规则秒回的问题不发占位卡。没听懂 / 出错时占位卡也会收尾，不会一直挂着。`Sender.update` 是可选接口，不支持的平台自动退化为直接发结果。

### 14.8 语义化的入口
智能模式下，只有 `/指令` 或不带参数的单个指令词（“总览”“帮助”）走固定指令；“复投 libtv”“抓取 libtv 近7天”也按人话处理（抓取先确认）。
帮助卡片改为大白话示例，固定写法降为“指令速查”。竞品名忽略大小写与空格。

### 14.9 联调时多看两眼
- 占位卡更新依赖飞书 `PATCH /im/v1/messages/:id`：需要应用有发消息权限，且卡片 `update_multi:true`（已设置）。若更新失败会自动改发新消息。
- 周报按服务器本地时区判断“周几 / 几点”。
