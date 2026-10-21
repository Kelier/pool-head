import Link from "next/link";
import type { ReactNode } from "react";
import { PageHead } from "@/components/ui";
import m from "./help.module.css";

export const metadata = { title: "使用说明 · 竞品投放监测" };

const TOC: Array<[string, string]> = [
  ["start", "快速开始"], ["concepts", "核心概念"], ["pages", "各页面用途"], ["limits", "数据口径与限制"],
  ["cost", "防封与成本"], ["export", "导出与报告"], ["faq", "常见问题"], ["tips", "快捷操作"],
];

function Sec({ id, n, title, lead, children }: { id: string; n: number; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className={`card pad ${m.sec}`}>
      <h2>{n}. {title}</h2>
      {lead && <p className={m.lead}>{lead}</p>}
      {children}
    </section>
  );
}

function Toc() {
  return (
    <>
      {TOC.map(([id, t], i) => <a key={id} href={`#${id}`}><b>{i + 1}</b>{t}</a>)}
    </>
  );
}

export default function HelpPage() {
  return (
    <>
      <PageHead title="使用说明" sub="从建竞品到导出报告的完整流程，以及数据口径、成本与排障" />
      <details className={`card ${m.tocMobile}`}>
        <summary>目录</summary>
        <nav><Toc /></nav>
      </details>
      <div className={m.layout}>
        <nav className={m.toc} aria-label="目录"><Toc /></nav>

        <div className={m.body}>
          <Sec id="start" n={1} title="快速开始" lead="五步从零到第一份竞品投放报告。">
            <ol className={m.steps}>
              <li><div><strong>建竞品</strong>在 <Link href="/competitors">竞品管理</Link> 新建竞品：填名称、监测关键词（如 <code>libtv导演台</code>）、要监测的平台。关键词可多个，命中任一即可。</div></li>
              <li><div><strong>发起抓取</strong>点竞品上的「立即抓取」，选时间范围（近 7 / 30 / 90 天或指定日期）。弹窗底部会显示预估 API 调用量；想持续监测就在竞品详情里开「定时监控」。</div></li>
              <li><div><strong>看总览</strong>任务完成后到 <Link href="/">总览</Link> 看各竞品的账号数、高频复投数、12 周趋势、层级分布，以及本周新增账号。</div></li>
              <li><div><strong>处理账号</strong>在 <Link href="/accounts">账号库</Link> 筛出高频复投账号，点开抽屉查看全部投放作品；给账号标状态（重点关注 / 已联系 / 已排除）、打标签、写备注；误判的作品点「不是投放」。</div></li>
              <li><div><strong>导出 / 报告</strong>用右上角「导出」下载 CSV、Excel、PDF；竞品详情页可打开可打印的「监测报告」。两次抓取之间的变化用 <Link href="/compare">对比分析</Link> 查看。</div></li>
            </ol>
          </Sec>

          <Sec id="concepts" n={2} title="核心概念">
            <div className={m.grid2}>
              <div className={m.mini}><b>竞品</b><span>监测对象，自带关键词和平台。账号、趋势、复投率都按竞品聚合。</span></div>
              <div className={m.mini}><b>监测任务</b><span>一次抓取：按竞品（或临时关键词）在所选平台搜索、判定、入库。可重跑、取消、删除。</span></div>
              <div className={m.mini}><b>去重聚合（scope）</b><span>同一竞品下，同一作品被多次任务抓到只计一次；任务详情仍保留各自的快照，便于前后对比。</span></div>
              <div className={m.mini}><b>高频复投</b><span>同一账号对<b>同一竞品</b>的投放次数 ≥ N（默认 2，可在设置里改）。跨竞品的次数不会相加。</span></div>
            </div>
            <h3>频次标签</h3>
            <table className={m.tbl}><tbody>
              <tr><td>单次试投</td><td>对单个竞品投放 1 次</td></tr>
              <tr><td>2-3 次复投</td><td>对单个竞品投放 2–3 次</td></tr>
              <tr><td>深度绑定</td><td>对单个竞品投放 ≥ 4 次</td></tr>
            </tbody></table>
            <h3>粉丝分层</h3>
            <p>默认：<b>头部</b> ≥ 100 万，<b>腰部</b> 10–100 万，<b>尾部</b> 1–10 万，<b>素人</b> &lt; 1 万；粉丝数拿不到的显示「未知」。阈值可在 <Link href="/settings">规则与设置</Link> 修改，立即对全部历史数据生效。</p>
            <h3>置信度与判定依据</h3>
            <p>作品先要命中任务关键词（关键词会拆成英文词与中文片段，全部出现即命中，所以 <code>libtv导演台</code> 能命中 “LibTV 打通…3D 导演台”）。基础分 <b>0.5</b>；话题标签命中 <b>+0.1</b>；命中「推广特征词组」（合作、商单、广告、邀请码…）再按词组权重加分，上限 1；命中排除词直接丢弃。低于最低置信度（默认 0.5）的不入库。每条作品的判定依据在账号抽屉里悬停置信度即可看到。</p>
            <h3>人工否决</h3>
            <p>在账号抽屉里点作品的「不是投放」，该作品<b>全局</b>不再计入任何次数，随时可「恢复」。适合处理个别误判；系统性误判请改规则。</p>
          </Sec>

          <Sec id="pages" n={3} title="各页面用途">
            <table className={m.tbl}><tbody>
              <tr><td><Link href="/">总览</Link></td><td>全局看板：KPI、12 周投放趋势（按竞品分色）、层级与平台分布、各竞品对比、本周新增与高频复投 Top。</td></tr>
              <tr><td><Link href="/competitors">竞品管理</Link></td><td>增删改竞品；详情页有该竞品的账号库、趋势、定时监控、任务历史，并可导出或打开监测报告。</td></tr>
              <tr><td><Link href="/tasks">监测任务</Link></td><td>全部历史任务：状态、结果摘要，可重跑 / 取消 / 删除，勾选两个任务一键对比；详情页回看当次结果。</td></tr>
              <tr><td><Link href="/accounts">账号库</Link></td><td>跨竞品、跨任务的账号聚合。搜索、按竞品 / 平台 / 层级 / 状态 / 粉丝区间筛选，筛选条件写在网址里，可直接分享。</td></tr>
              <tr><td><Link href="/compare">对比分析</Link></td><td>任务对比看「新增 / 流失 / 持续 / 新晋复投」；竞品对比看共同 KOL、独占账号与重合度矩阵。</td></tr>
              <tr><td><Link href="/alerts">提醒中心</Link></td><td>任务完成、新晋复投账号、预算超 80%、任务失败、定时任务被跳过。未读数显示在侧边栏。</td></tr>
              <tr><td><Link href="/settings">规则与设置</Link></td><td>判定规则（推广词组、排除词）、复投阈值、粉丝分层；调用监控（预算、14 天调用量）；防封策略说明。</td></tr>
            </tbody></table>
          </Sec>

          <Sec id="limits" n={4} title="数据口径与限制" lead="用数据前请先了解这些边界。">
            <ul>
              <li><b>搜索不保证全量。</b>数据来自各平台搜索接口，每个关键词最多翻 N 页（默认 3），结果是“尽力抓取”，不是全网普查。</li>
              <li><b>抖音播放量恒为 0。</b>搜索结果不带播放量，互动过滤只用点赞与评论。</li>
              <li><b>快手综合搜索相关性较差。</b>返回里噪声多，主要靠关键词与判定规则过滤，命中数可能偏少。</li>
              <li><b>同作品跨任务只计一次。</b>聚合视图按（平台 + 作品 + 竞品）去重；任务详情页是该次任务的快照。</li>
              <li><b>粉丝数未知时保留。</b>设置了粉丝区间过滤，但补不到粉丝数的账号会保留并显示“未知”，宁多勿漏。</li>
              <li><b>评论区识别未做。</b>PRD 提到的评论区 / 带货标签判定目前未实现，判定只看标题、话题与正文片段。</li>
              <li><b>“投放”是推断。</b>判定依据是关键词与推广特征词，不等同于已确认的商单；请用置信度与人工否决校正。</li>
            </ul>
          </Sec>

          <Sec id="cost" n={5} title="防封与成本" lead="TikHub 已承担对各平台的反爬对抗；本系统负责不触顶限流、不重复计费、不被失败风暴拖垮。">
            <table className={m.tbl}><tbody>
              <tr><td>全局限速</td><td>默认 3 QPS（硬上限 8，官方上限 10），请求之间再加 50–300ms 随机抖动。</td></tr>
              <tr><td>并发</td><td>全局 ≤ 4、单平台 ≤ 2；同时最多跑 2 个任务。</td></tr>
              <tr><td>重试</td><td>仅对 429 / 5xx / 超时重试，最多 3 次，1s → 2s → 4s（±20%）；参数类 4xx 不重试。</td></tr>
              <tr><td>熔断</td><td>1 分钟内连续失败 5 次，冷却 60 秒；401 / 402 / 403（鉴权、余额、权限）直接暂停全部请求。</td></tr>
              <tr><td>缓存</td><td>搜索结果缓存 1 小时，账号资料缓存 24 小时；相同请求命中缓存不出站、不计费，并发的相同请求合并为一次。重跑任务因此几乎零成本。</td></tr>
              <tr><td>每日预算</td><td>默认 5000 次（<code>TIKHUB_DAILY_BUDGET_CALLS</code>）。创建任务前先预估，超预算直接拒绝；运行中用完会暂停任务，定时监控自动跳过；达到 80% 在提醒中心告警。</td></tr>
            </tbody></table>
            <h3>预估调用量怎么算</h3>
            <p><b>平台数 × 关键词数 × 翻页数</b> + 补粉丝数的调用。抖音搜索结果自带粉丝数，不用额外调用；<b>小红书、快手、B 站</b>每个命中账号需要 1 次调用补粉丝数（预估按每页约 12 个账号、单平台最多 100 次估算，实际取决于命中数）。关键词越多、翻页越深、平台越多，成本越高——先用小范围试跑。</p>
          </Sec>

          <Sec id="export" n={6} title="导出与报告" lead="导出内容与屏幕上的筛选条件一致。">
            <table className={m.tbl}><tbody>
              <tr><td>CSV</td><td>通用、体积小，适合导入其他系统或脚本处理。带 UTF-8 BOM，Excel 直接打开不乱码；以 = + - @ 开头的文本会加前缀，防公式注入。</td></tr>
              <tr><td>Excel (.xlsx)</td><td>给运营同事直接看 / 筛选 / 做透视表；账号与作品明细、对比结果按工作表分开。</td></tr>
              <tr><td>PDF</td><td>用于汇报与归档，版式固定，适合发给不使用本系统的人。</td></tr>
              <tr><td>JSON</td><td>完整结构化数据（含判定依据、竞品归属），适合二次开发。</td></tr>
            </tbody></table>
            <p>竞品详情页的「监测报告」是单独的可打印页面：封面、核心指标、趋势、分布、复投 Top 15、新增账号与方法说明；点页面顶部「打印 / 保存为 PDF」即可。</p>
          </Sec>

          <Sec id="faq" n={7} title="常见问题">
            <div className={m.faq}>
              <details>
                <summary>任务失败，提示“熔断中”</summary>
                <p>说明短时间内连续失败，系统暂停请求保护额度。报错里会带上最近一次的真实原因，按原因处理后等 60 秒，在任务详情点「重跑」。1 小时内重复的请求会命中缓存，不重复计费。401 / 402 / 403 是鉴权或余额问题，需修复后<b>重启服务</b>。</p>
              </details>
              <details>
                <summary>提示 “fetch failed” / 连接 TikHub 超时 / 域名解析失败</summary>
                <p>通常是本机 DNS、VPN 或代理导致连不上 <code>api.tikhub.io</code>。在项目根目录的 <code>.env</code> 里设置代理并重启服务：</p>
                <div className={m.pre}>TIKHUB_PROXY=http://127.0.0.1:7890</div>
                <p>端口换成你代理软件的 HTTP 端口，并确认代理软件在运行。不需要代理时把它留空。</p>
              </details>
              <details>
                <summary>预算用尽（任务状态“预算用尽”）</summary>
                <p>提高 <code>.env</code> 里的 <code>TIKHUB_DAILY_BUDGET_CALLS</code> 后重启；或次日自动清零。预算按“当天已发出的真实请求数”统计，缓存命中不计。</p>
              </details>
              <details>
                <summary>怎么改判定规则？</summary>
                <p>在 <Link href="/settings">规则与设置</Link> 的「判定规则」里增删推广词组、调权重、加排除词，并可调整最低置信度、复投阈值与分层阈值。规则只对之后新建的任务生效，历史数据保持原判定；要套用新规则，请重跑任务。</p>
              </details>
              <details>
                <summary>定时监控为什么没跑？</summary>
                <p>定时监控由服务进程内的调度器每分钟检查一次，<b>服务没在运行时不会触发</b>，且不会补跑。也可能因为当日预算已用完被跳过（会有提醒）。长期运行建议部署成常驻服务，上线时改用系统 Cron / 队列。</p>
              </details>
              <details>
                <summary>数据存在哪？怎么备份？</summary>
                <p>全部数据在 <code>data/gtm.db</code>（SQLite，WAL 模式）。备份时请连同 <code>gtm.db-wal</code>、<code>gtm.db-shm</code> 一起复制，或先停服务再复制；也可以：</p>
                <div className={m.pre}>sqlite3 data/gtm.db ".backup data/backup.db"</div>
              </details>
            </div>
          </Sec>

          <Sec id="tips" n={8} title="快捷操作">
            <ul>
              <li>表格里<b>点一行</b>打开账号抽屉；<b>点表头</b>排序；按 <code>Esc</code> 关闭抽屉和弹窗。</li>
              <li>标签输入框（排除词、推广词组）：<code>Enter</code> 或逗号添加，<code>Backspace</code> 删除末尾，可直接粘贴一串词自动拆分去重。</li>
              <li>账号库的筛选条件会写进网址，刷新可还原，复制链接就能分享同一视图。</li>
              <li><code>/compare?a=任务ID&amp;b=任务ID</code> 可直接打开两个任务的对比；监测任务列表勾选两个任务也能一键跳转。</li>
              <li>侧边栏底部的进度条是今日 API 调用量，悬停可看说明；变橙 / 变红表示接近预算。</li>
            </ul>
          </Sec>
        </div>
      </div>
    </>
  );
}
