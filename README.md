# 竞品投放监测

按关键词与时间范围，自动抓取竞品在 **抖音 / 小红书 / 快手 / B站** 上投放过的账号，识别被**反复投放的核心 KOL**，并提供趋势、分层、对比、导出与报告。数据源为 [TikHub API](https://docs.tikhub.io/)。

> 站内也有同样内容的「使用说明」：启动后访问 `/help`。

## 功能

| 模块 | 说明 |
|---|---|
| 竞品管理 | 监测对象实体（关键词 + 平台），账号 / 趋势 / 复投率按竞品聚合 |
| 监测任务 | 手动、定时、重跑；可取消 / 删除；进度、失败原因、历史回看 |
| 判定引擎 | 关键词分词匹配 + 可配置的推广特征词组 + 排除词 + 置信度；人工否决误判 |
| 高频复投 | 同一账号对同一竞品投放 ≥ N 次（默认 2）；频次标签：单次试投 / 2-3 次复投 / 深度绑定 |
| 账号库 | 跨竞品跨任务聚合，搜索 / 多维筛选 / 排序，筛选状态同步到 URL；状态、标签、备注 |
| 分层 | 头部 / 腰部 / 尾部 / 素人，阈值可配 |
| 对比分析 | 任务前后对比（新增 / 流失 / 持续 / 新晋复投）；竞品间共同 KOL 与重合度矩阵 |
| 导出与报告 | CSV / Excel / PDF / JSON；可打印的竞品监测报告 |
| 提醒 | 任务完成、新晋复投、预算 80%、任务失败 |
| 设置 | 判定规则、复投阈值、分层阈值；调用监控；防封策略说明 |

## 快速开始

环境：Node.js ≥ 22.13（使用内置 `node:sqlite`），pnpm。

```bash
pnpm install
cp .env.example .env     # 然后编辑 .env，填入 TIKHUB_API_KEY
pnpm dev                 # http://localhost:3000
```

首次打开数据库是空的：先到「竞品管理」建一个竞品，再点「立即抓取」。

想先看看效果（不调用 TikHub、不耗额度），灌入演示数据：

```bash
DB_FILE=/tmp/demo.db node --import tsx scripts/seed.ts
DB_FILE=/tmp/demo.db pnpm dev
```

### 环境变量（`.env`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TIKHUB_API_KEY` | —（必填） | TikHub API Key，仅服务端使用，不会出现在页面或接口响应里 |
| `TIKHUB_BASE_URL` | `https://api.tikhub.io` | API 地址 |
| `TIKHUB_GLOBAL_QPS` | `3` | 全局限速（请求/秒）。官方上限 10，代码里硬顶 8 |
| `TIKHUB_PLATFORM_CONCURRENCY` | `2` | 单平台最大并发 |
| `TIKHUB_DAILY_BUDGET_CALLS` | `5000` | 每日真实调用预算（缓存命中不计）；用完后拒绝新请求 |
| `TIKHUB_TIMEOUT_MS` | `45000` | 单次请求超时（官方建议 30–60s） |
| `TIKHUB_MAX_RETRIES` | `3` | 最大重试次数（上限 3） |
| `TIKHUB_PROXY` | 空 | HTTP 代理，如 `http://127.0.0.1:7890`。本机 DNS / VPN 导致 `fetch failed` 时设置 |
| `DB_FILE` | `data/gtm.db` | SQLite 文件路径 |

修改 `.env` 后需重启服务。`.env` 已在 `.gitignore` 中，**不要提交**。

## 飞书机器人

团队成员可以在飞书里 @ 机器人完成查询：`总览`、`竞品 LibTV`、`复投`、`新增`、`对比 A B`、`导出 账号 LibTV`；管理员还能 `抓取 LibTV 近30天`，并订阅新增复投 / 任务完成 / 预算告警的主动推送。
也可以**直接说人话**：「libtv 最近有啥新账号」「把可灵的报告导出来」「帮我重新抓一下即梦近 7 天」——意图层会先理解、再调用现有能力；会花钱的抓取必须回复「确认」才执行。默认用规则解析（免费），可选接入大模型（`BOT_AGENT=llm`，默认 DeepSeek，也支持 Claude 与任意 OpenAI 兼容服务）。
默认拒绝未授权用户；支持**长连接**（本机/内网，无需公网）与 **Webhook** 两种接入。

```bash
pnpm start -p 3111   # Web 应用
pnpm bot             # 飞书长连接机器人（需在 .env 配置 FEISHU_*）
```

完整的配置步骤、权限模型、接口契约（`Sender` / `BotBackend` / `Command` / 意图层工具表）、部署与排障见 **[docs/FEISHU_BOT.md](docs/FEISHU_BOT.md)**。

## 目录结构

```
src/
  app/            页面（App Router）与 API 路由
    api/          REST 接口：competitors / tasks / accounts / account / compare / export / settings / usage / alerts …
    help/         站内使用说明
    reports/      可打印的竞品监测报告
  components/     设计系统组件：Shell、AccountTable、AccountDrawer、TagInput、图表…
  lib/
    tikhub/       TikHubClient（限流 / 重试 / 熔断 / 缓存 / 预算）与限流原语
    platforms/    抖音 / 小红书 / 快手 / B站 适配器（搜索 → 统一结构 NormPost）
    bot/          飞书机器人：指令层 / 权限限流 / 事件适配 / 卡片 / 推送（详见 docs/FEISHU_BOT.md）
    pipeline.ts   抓取流水线：搜索 → 判定 → 补粉丝 → 入库 → 统计 → 提醒
    classify.ts   判定引擎        settings.ts 规则与分层设置
    queries.ts    读模型：聚合、总览、趋势、对比、用量
    scheduler.ts  进程内定时监控  db.ts 本地存储与迁移
scripts/          seed.ts 演示数据 · smoke.ts 真实冒烟 · shot.mjs 截图工具
tests/            单元 / 集成测试（含真实响应样本 fixtures）
```

## 数据模型

```
competitors ─┬─< tasks ──< promo_posts >── accounts ──< account_meta（状态/标签/备注）
             └─< schedules                      │
                                         post_flags（人工否决）
settings · alerts · api_calls（调用日志）· api_cache（响应缓存）
```

- `tasks.scope`：竞品任务为 `c<竞品id>`，临时任务为 `t<任务id>`；聚合时按（平台 + 作品 + scope）取最新一条，所以同一作品被多次任务抓到只计一次，而任务详情仍是该次的快照。
- 账号以平台稳定 ID 归集（抖音 `sec_uid`、小红书 `user_id`、B站 `mid`…），不用昵称。

## 防封 / 防打爆策略

TikHub 已承担对各平台的反爬对抗；本项目负责不触顶限流、不重复计费、不被失败风暴拖垮。所有出站请求只经过 `TikHubClient`。

| 策略 | 参数 |
|---|---|
| 全局令牌桶 | 默认 3 QPS + 50–300ms 随机抖动 |
| 并发闸 | 全局 ≤ 4，单平台 ≤ 2，同时最多 2 个任务 |
| 退避重试 | 仅 429 / 5xx / 超时；最多 3 次，1s → 2s → 4s（±20%），遵守 `Retry-After` |
| 熔断 | 1 分钟内连续失败 5 次 → 冷却 60s；401/402/403 直接暂停全部请求 |
| 缓存 + 请求合并 | 搜索 1h、账号资料 24h；相同并发请求合并为一次 |
| 预算 | 创建任务前预估，超预算拒绝；运行中用完则暂停；80% 告警 |
| 翻页止损 | 按最新排序，整页早于时间范围起点即停止 |
| 日志 | 每次调用记录 endpoint / 状态 / 耗时 / 是否命中缓存（不记录密钥） |

预估调用量 = 平台数 × 关键词数 × 翻页数 + 补粉丝数调用（小红书 / 快手 / B站每个命中账号 1 次；抖音搜索结果自带粉丝数）。

## 测试

```bash
pnpm test          # 单元 + 集成测试（不调用真实 API）
pnpm typecheck
pnpm smoke 关键词   # 真实调用 TikHub 的端到端冒烟，会少量计费
```

## 已知限制

- 搜索不保证全量，结果是"尽力抓取"。
- 抖音搜索结果的播放量恒为 0，互动过滤只用点赞 / 评论；快手综合搜索相关性较差。
- "投放"是基于关键词与推广特征词的**推断**，不等同于已确认商单；判定规则默认集待 PRD 补齐"投放特征"后再调。
- 评论区 / 带货标签识别未实现（需逐作品拉评论，成本高，建议作为可选"深度核查"二期做）。
- 无登录 / 权限体系，本地单用户。
- 定时监控为进程内调度：服务没运行就不会触发，也不会补跑。

## 上线注意

当前为本地版，尚未部署。上线前需要：

1. 存储从本地 SQLite 换成 Postgres：只需替换 `src/lib/db.ts` 与 `src/lib/queries.ts` 的 SQL。
2. 任务执行从进程内改为队列 / Workflow（`pipeline.ts` 里的 `createTask`），否则 Serverless 实例回收会中断任务。
3. 定时监控改用 Cron 触发 `runDueSchedules`（`src/lib/scheduler.ts`）。
4. 限流 / 熔断 / 预算计数改为跨实例共享（Redis 或数据库），进程内计数器在多实例下不准。
5. 在部署平台的环境变量里配置 `TIKHUB_API_KEY`（Production / Preview 分开），并加上访问控制。
6. 轮换曾经暴露过的 Key。
