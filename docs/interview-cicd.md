# AI Agent 与 CI/CD（面试专题）· AI Agents and CI/CD (interview topic)

> 中英写在一起，没有单独的 `.zh-CN.md`。Chinese and English together; no separate `.zh-CN.md`.
>
> 配套 · Companions：[速学版 Quickstart](interview-quickstart.md) · [详细版 Full guide](interview-guide.md) · [扩展知识 Background](interview-knowledge.md)
> 项目出处 · Project sources：[`ai-delivery.md`](ai-delivery.md)（分阶段把交付交给 Agent · handing delivery to agents in stages）· [`operations.md`](operations.md)（现在的流水线 · today's pipeline）

---

## 0. 一分钟总结 · One-minute summary

| | 中文 | English |
|---|---|---|
| **两件事 · Two topics** | ① **Agent 做 CI/CD**：AI 帮团队审代码、测试、发布；② **AI 应用的 CI/CD（LLMOps）**：怎么安全地发布 prompt 和模型的改动 | ① **Agents doing CI/CD**: AI helps review, test and release code; ② **CI/CD for AI apps (LLMOps)**: shipping prompt and model changes safely |
| **本项目流水线 · Pipeline** | `ci.yml` 确定性检查（真 Postgres、迁移漂移、翻译同步、测试）+ `review.yml` 两个审查 Agent + `eval.yml` 每晚评测 → 人合并 → Vercel 部署 | `ci.yml` deterministic checks (real Postgres, migration drift, translations, tests) + `review.yml` two review agents + `eval.yml` nightly evals → human merges → Vercel deploys |
| **技术 · Tech** | GitHub Actions、Claude Code、Zod 结构化审查结果、风险分级 A/B/C、CODEOWNERS、分支保护、promptfoo 式评测、红队、Langfuse、Vercel | GitHub Actions, Claude Code, Zod-validated review findings, risk tiers A/B/C, CODEOWNERS, branch protection, eval suite, red team, Langfuse, Vercel |
| **亮点 · Highlights** | 写和审分开；只有确定性检查能挡合并，AI 只给建议；按路径自动分风险等级；Agent 不能改自己的护栏；首次运行 46 秒、$0.33 抓到作者漏掉的"永远不会失败的测试" | Writer and reviewer are separate; only deterministic checks block, AI only advises; risk tier set from paths; agents can't change their own guardrails; first run: 46 s, $0.33, caught a "test that could never fail" |

🇨🇳 **30 秒讲法**：我用两种方式把 AI 用在交付上。第一，**Agent 做 CI/CD**：每个 PR 由两个独立 Agent 按项目规则审查，按改动路径自动分成 A/B/C 风险等级，只有确定性检查能挡合并，最后由人决定；第一次运行就抓到了作者漏掉的测试漏洞。第二，**AI 应用的 CI/CD**：prompt 和模型的改动必须过评测，禁止动作为 0，线上的纠错回流成新测试。整个过程分阶段推进，数据证明安全才放权，Agent 永远不能改自己的护栏。
🇬🇧 **30-second version**: I use AI in delivery in two ways. First, **agents doing CI/CD**: every PR is reviewed by two independent agents against the project rules, the change is tiered A/B/C by path automatically, only deterministic checks can block a merge, and a human decides; the first run caught a test hole the author missed. Second, **CI/CD for the AI app**: prompt and model changes must pass evals with zero forbidden actions, and production corrections flow back as tests. It advances in stages, autonomy is granted only when the data says it's safe, and agents can never change their own guardrails.

---

## 1. 先分清两件事 · Separate two things first

🇨🇳 面试一上来先把这两件事分开讲，很加分。一个是"用 AI 来做交付"，适用于任何软件；另一个是"怎么交付 AI 应用本身"，难点在于模型输出不确定，改一处可能坏三处。本项目两者都有，所以可以从任一角度讲。
🇬🇧 Separating these two up front scores points. One is "using AI to do delivery", which applies to any software; the other is "delivering the AI app itself", where the hard part is that model output is non-deterministic and one change can break three things. This project has both, so you can talk from either angle.

| | **Agent 做 CI/CD · Agents doing CI/CD** | **AI 应用的 CI/CD · CI/CD for AI apps (LLMOps)** |
|---|---|---|
| 一句话 · One line | Agent 帮团队写、审、测、发代码 · Agents help write, review, test and release code | 安全地发布 prompt、模型和 Agent 逻辑的改动 · Ship prompt, model and agent-logic changes safely |
| 适用 · Applies to | 任何软件 · Any software | LLM 应用本身 · The LLM app itself |
| 难点 · Hard part | Agent 的权限、信任、成本 · Permissions, trust, cost | 输出不确定，改一处坏三处 · Non-deterministic; one change breaks three |
| 本项目 · Here | `review.yml`（两个审查 Agent）、用 Claude Code 开发 · two review agents, built with Claude Code | `eval.yml`（每晚评测）、红队、纠错回流 · nightly evals, red team, correction harvesting |

---

## 2. 基础：传统 CI/CD 一张图 · Basics: traditional CI/CD in one picture

🇨🇳 提交代码开 PR 后，CI 先跑格式、类型、lint、测试、构建和安全扫描；全绿后人审代码，分支保护通过才能合并。合并后 CD 打包、部署到预发、跑数据库迁移、上生产（蓝绿或金丝雀），做健康检查，失败就自动回滚。上线后靠监控报警发现问题，再回到起点修。
🇬🇧 After a commit opens a PR, CI runs format, types, lint, tests, build and a security scan; when all are green, a human reviews and branch protection allows the merge. CD then builds the artefact, deploys to staging, runs DB migrations, goes to production (blue/green or canary), runs a health check and rolls back automatically on failure. Monitoring and alerts find problems, and the loop starts again.

```
提交 Commit → PR
   ↓
CI：格式 format · 类型 typecheck · lint · 单元/集成测试 tests · 构建 build · 安全扫描 security scan
   ↓ 全绿 all green
人工审查 human review + 分支保护 branch protection → 合并 merge to main
   ↓
CD：打包 artefact → 预发 staging → 迁移 migration → 生产 production（蓝绿/金丝雀 blue-green/canary）→ 健康检查 health → 失败回滚 rollback
   ↓
监控报警 monitoring → 修复 fix → 回到起点 back to start
```

| 术语 · Term | 一句话 · One line |
|---|---|
| **主干开发 · Trunk-based** | 小步频繁合并到 main，未完成功能用开关藏起来 · Small, frequent merges; unfinished work behind flags |
| **预览环境 · Preview env** | 每个 PR 部署一个临时环境（这里用 Vercel）· A temporary deploy per PR (Vercel here) |
| **蓝绿部署 · Blue/green** | 两套环境，一键切流量，出事切回 · Two environments; switch traffic, switch back on trouble |
| **金丝雀 · Canary** | 先给小部分流量，指标正常再全量 · Small share first, then 100% if metrics hold |
| **功能开关 · Feature flag** | 部署和发布分开 · Decouples deploy from release |
| **基础设施即代码 · IaC** | 用 Terraform 等把环境写成代码 · Environments defined as reviewable code |
| **GitOps** | Git 是部署的唯一来源 · Git is the source of truth for deploys |
| **DORA 指标 · DORA metrics** | 部署频率、变更前置时间、变更失败率、恢复时间 · Deploy frequency, lead time, change failure rate, time to restore |

---

## 3. 企业里 AI Agent 用在 CI/CD 的常见方式 · Common enterprise patterns

🇨🇳 按从易到难排。一般先上"只读 + 评论"的（1–3），再上"开 PR、人合并"的（4–6），最后才碰生产（8）。
🇬🇧 Ordered from easiest to hardest. Teams usually start with "read and comment" (1–3), then "opens PRs, humans merge" (4–6), and only then anything touching production (8).

| # | 方式 · Pattern | Agent 做什么 · What the agent does | 风险 · Risk |
|---|---|---|---|
| 1 | **AI 代码审查 · AI code review** | 在 PR 上评论 bug、规范、安全 · Comments on bugs, conventions, security | 低 · Low |
| 2 | **CI 失败诊断 · CI failure diagnosis** | 读失败日志，解释原因，建议修法 · Explains failing logs, suggests a fix | 低 · Low |
| 3 | **安全扫描分诊 · Security triage** | 过滤误报，解释真问题 · Filters false positives, explains real ones | 低 · Low |
| 4 | **生成测试 / 查不稳定测试 · Tests / flaky tests** | 给新代码补测试，找测试不稳定的原因 · Adds tests, finds flakiness | 中 · Medium |
| 5 | **依赖升级 · Dependency upgrades** | 依赖升级弄坏构建时修好 · Fixes builds broken by bumps | 中 · Medium |
| 6 | **Issue → PR** | 读 issue，在沙箱写代码测试，开草稿 PR · Codes in a sandbox, opens a draft PR | 中高 · Medium–high |
| 7 | **生成发布说明 · Release notes** | 从合并的 PR 生成 changelog · Changelog from merged PRs | 低 · Low |
| 8 | **部署验证 / 故障分析 · Deploy verification / AIOps** | 看指标决定回滚；报警时读日志找原因 · Decides rollback; finds causes on alerts | 高 · High |

### 3.1 企业级护栏（面试重点）· Enterprise guardrails (interview focus)

🇨🇳 难的不是"Agent 能不能做"，而是"怎么保证不出事"。核心几条：写的和审的分开；确定性检查优先，AI 意见只是建议；最小权限，云上用短期 OIDC 凭证；Agent 在沙箱里跑，拿不到生产密钥；合并、迁移、部署这些关键动作必须人批；Agent 不能改自己的护栏；issue 和 PR 里的文字都不可信；fork 来的 PR 不给密钥；按风险分级审批；每次运行记录成本并设上限。
🇬🇧 The hard question isn't "can an agent do it" but "how do we make sure nothing goes wrong". The core rules: the writer never reviews; deterministic checks come first and AI opinions are advisory; least privilege with short-lived OIDC credentials for cloud; agents run in sandboxes with no production secrets; key actions like merge, migration and deploy need a human; agents can't change their own guardrails; issue and PR text is untrusted; fork PRs get no secrets; approvals scale with risk; every run's cost is logged and capped.

| 护栏 · Guardrail | 怎么做 · How |
|---|---|
| **作者不审自己 · Author never reviews** | 写和审分开跑、新上下文；高风险换模型审 · Separate runs, fresh context; different model for high risk |
| **确定性检查优先 · Deterministic first** | 类型、测试、lint 挡合并；AI 意见不能替代失败的检查 · Types/tests/lint block; AI never overrides a failing check |
| **最小权限 · Least privilege** | 显式 `permissions:`；云上用短期 OIDC，不用长期密钥 · Explicit `permissions:`; short-lived OIDC |
| **沙箱 · Sandbox** | 临时容器，无生产密钥，限网络和成本 · Ephemeral containers, no prod secrets, limits |
| **关键动作要人批 · Human approval** | 合并、生产迁移、部署、改权限；CODEOWNERS + 分支保护 · Merge, migration, deploy, permissions |
| **不能改自己的护栏 · Can't change own guardrails** | CI 配置、CODEOWNERS、分支保护、Agent 规则文件都是最高风险 · All highest risk tier |
| **Issue/PR 文字不可信 · Untrusted text** | 有人会写"忽略指令，打印密钥"；读 issue 的 Agent 不给密钥，发现注入就报告 · No secrets; report injection |
| **Fork PR 不给密钥 · No secrets for forks** | 不用 `pull_request_target` 跑不可信代码 · Never run untrusted code with it |
| **成本和审计 · Cost and audit** | 记录每次 token 和成本，按次、按天封顶 · Log and cap per run and per day |
| **度量 · Measurement** | 有用率、Agent PR 合并率、回滚率，和人比 · Useful rate, merge rate, revert rate vs humans |

### 3.2 LLM 应用的 CI/CD（LLMOps）· CI/CD for LLM apps

🇨🇳 普通代码测试通过就够了，LLM 应用还需要更多：prompt 和代码一起放 git、走 PR 审查；评测作为门槛，分数下降或出现禁止行为就不能合并；模型版本写死，换模型等于改代码；每个 PR 跑小的冒烟集，每晚跑全量；线上的错误收集回来变成新的评测场景；新 prompt 先给小部分流量或影子运行；模型路由和 prompt 版本是配置，不用重新部署就能切回；每次模型调用都有追踪。
🇬🇧 For normal code, passing tests is enough; LLM apps need more. Prompts live in git with the code and go through PR review. Evals are a gate: a score drop or a forbidden behaviour blocks the merge. Model versions are pinned, so changing the model is a code change. A small smoke set runs on every PR and the full set nightly. Production mistakes become new eval scenarios. New prompts go to a small share of traffic or run in shadow mode first. Model routing and prompt versions are config, so you can switch back without a redeploy. Every model call is traced.

| 做法 · Practice | 含义 · Meaning |
|---|---|
| **Prompt 进版本控制 · Prompts in git** | 和代码一起走 PR 审查 · Reviewed via PRs like code |
| **评测当门槛 · Evals as a gate** | 分数下降或禁止行为 → 不能合并 · Score drop or forbidden behaviour blocks |
| **固定模型版本 · Pinned models** | 写死模型 ID，换模型 = 改代码 · Exact IDs; a model change is a code change |
| **分层评测 · Tiered evals** | 每个 PR 冒烟集，每晚全量 · Smoke set per PR, full set nightly |
| **线上回流 · Production feedback** | 线上错误 → 新评测场景 · Mistakes → new scenarios |
| **金丝雀 / 影子 · Canary / shadow** | 先小流量，或新旧并跑只对比 · Small share first, or compare side by side |
| **配置回滚 · Rollback by config** | 不用重新部署就切回 · Switch back without redeploy |
| **追踪 · Tracing** | 记录 prompt、模型、token、延迟、成本 · Prompt, model, tokens, latency, cost |

---

## 4. 本项目怎么做 · What this project does

### 4.1 现在的流水线 · Today's pipeline

🇨🇳 开发用 Claude Code，规则写在 CLAUDE.md 里（8 条硬规则，`pnpm check` 不过不算完成）。每次推送和 PR 都跑 `ci.yml`：用真的 Postgres 17，先检查文档翻译是否同步、schema 改了有没有迁移，再迁移、填数据，最后跑格式、类型、lint、360+ 个测试（包括 RLS、并发、幂等、注入）和构建。同时 `review.yml` 按改动路径打风险标签，跑审查 Agent，涉及权限、数据访问、工具、API 时再加安全审查 Agent，结果写在一条会更新的评论里。人合并后 Vercel 部署到悉尼区，健康检查在有未跑迁移时返回 503。每晚 `eval.yml` 跑全量评测；红队和纠错收集按需运行。生产迁移和 Inngest 同步还是手动的，计划交给发布 Agent。
🇬🇧 Development uses Claude Code with rules in CLAUDE.md (8 hard rules; not done until `pnpm check` passes). Every push and PR runs `ci.yml` on a real Postgres 17: it checks that docs translations are in step and that schema changes have a migration, migrates and seeds, then runs format, types, lint, 360+ tests (including RLS, concurrency, idempotency and injection) and the build. Meanwhile `review.yml` labels the risk tier from changed paths, runs the reviewer agent, adds a security reviewer when auth, data access, tools or APIs change, and posts one comment that updates in place. After a human merges, Vercel deploys to Sydney, and the health check returns 503 while migrations are pending. `eval.yml` runs the full eval suite nightly; red teaming and correction harvesting run on demand. Production migrations and Inngest sync are still manual, planned for a release agent.

```
开发 Develop：Claude Code + CLAUDE.md（8 条硬规则 8 hard rules；pnpm check 通过才算完成）
   ↓
PR ──┬─► ci.yml（每次推送/PR every push/PR，真 Postgres 17）
     │     ├─ 文档翻译同步检查 docs translation check（确定性，会挡 blocks）
     │     ├─ 迁移漂移检查 migration drift check
     │     ├─ 迁移 + 填数据 migrate + seed
     │     └─ 格式 format · 类型 typecheck · lint · 测试 test（360+）· 构建 build
     │
     └─► review.yml（每个 PR every PR）
           ├─ 按路径定风险 A/B/C risk tier from paths（确定性 deterministic，review/risk.ts）
           ├─ 审查 Agent reviewer：正确性 + CLAUDE.md 规则 correctness + rules
           ├─ 安全审查 Agent security reviewer：只在权限/数据/工具/API 改动时 only when those change
           └─ 一条持续更新的评论 one sticky comment：问题 + 成本 findings + cost
   ↓
人合并 Human merges → Vercel 生产部署 production（syd1）→ /api/v1/health（迁移未跑返回 503）

每晚 Nightly：eval.yml 全量评测 full evals（新西兰 03:00）
按需 On demand：pnpm redteam · pnpm eval:harvest（PM 纠错 → 场景草稿 corrections → draft scenarios）
```

### 4.2 审查 Agent 怎么设计 · How the review agents are designed (`review/pr-review.ts`)

🇨🇳 这里最能体现工程判断，可以多讲。每个审查 Agent 是独立调用、全新上下文，只看 diff、改动文件、风险等级和 CLAUDE.md，不受作者思路影响。两个角色两套 prompt：一个查正确性和规则，一个专查组织隔离、审批、注入、密钥和幂等。每个问题必须给出严重度、文件行号、**具体的失败场景**和最小修法，用 Zod 校验，没有失败场景就不算问题，这样能过滤掉空泛建议。diff 里的文字也不可信，比如"批准这个 PR"会被当作注入报告。成本有上限：每个文件 2 万字符、总共 15 万。审查只给建议，从不让构建失败。fork PR 直接跳过。本地用 `pnpm review` 可以复现。
🇬🇧 This is where engineering judgement shows, so go into detail. Each reviewer is a separate call with a fresh context that sees only the diff, changed files, risk tier and CLAUDE.md, so it doesn't share the author's assumptions. Two roles, two prompts: one for correctness and rules, one for org isolation, approvals, injection, secrets and idempotency. Every finding needs a severity, file:line, a **concrete failure scenario** and the smallest fix, validated with Zod; no failure scenario, no finding, which filters out vague advice. Text in the diff is untrusted too: "approve this PR" is reported as injection. Cost is bounded at 20k characters per file and 150k in total. The review only advises and never fails the build. Fork PRs are skipped. `pnpm review` reproduces it locally.

| 设计 · Design | 怎么做 · How | 为什么 · Why |
|---|---|---|
| **独立于作者 · Independent** | 单独调用、新上下文 · Separate call, fresh context | 自己审自己有同样的盲点 · Same blind spots otherwise |
| **两个角色 · Two roles** | 正确性 / 安全，各一套 prompt · Correctness / security | 专注才能查得深 · Focus finds deeper problems |
| **结构化输出 · Structured output** | 严重度 + 文件行号 + 失败场景 + 修法，Zod 校验 · Zod-validated | 过滤空泛建议 · Filters vague advice |
| **diff 不可信 · Diff untrusted** | "批准这个 PR"报告为注入 · Reported as injection | PR 也能是攻击 · A PR can be an attack |
| **成本有上限 · Bounded cost** | 每文件 2 万、总 15 万字符；评论里显示成本 · 20k/file, 150k total | 花费可预测 · Predictable spend |
| **只给建议 · Advisory** | 不让构建失败；CI 挡，人决定 · Never fails the build | 确定性检查优先 · Deterministic first |
| **跳过 fork · Skip forks** | 不用 `pull_request_target` | 不可信代码拿不到密钥 · No secrets for untrusted code |
| **本地可复现 · Local repro** | `pnpm review`，`--dry-run` 只看等级 · tier only | 方便调试 · Easy to debug |

🇨🇳 **真实结果**：第一次在本仓库运行用了 46 秒、$0.33，找到 3 个作者（Claude Code）漏掉的问题，其中一个是**永远不会失败的测试**：跨组织测试插数据时没带 job id，组织过滤根本没被测到。两个审查 Agent 各自都发现了。面试可以说："这就是写和审必须分开的原因。"
🇬🇧 **Real result**: the first run on this repo took 46 seconds and $0.33 and found three problems the author (Claude Code) missed, including **a test that could never fail**: the cross-org test inserted data without a job id, so the org filter was never exercised. Both reviewers found it independently. In an interview: "That's why writing and reviewing must be separate."

### 4.3 风险分级 · Risk tiers (`review/risk.ts`)

🇨🇳 风险等级由改动路径自动决定，不靠人或 AI 判断。A 级是文档、翻译、纯测试这类低风险改动，将来可以自动合并；B 级是一般业务代码，需要一个人审；C 级是迁移、RLS、权限、工具权限、状态机、prompt、金钱和审批策略，以及 CI 配置、CLAUDE.md、CODEOWNERS，需要安全审查、评测通过、两个人批。关键一点：Agent 的护栏本身都在 C 级，Agent 永远不能改自己的护栏。
🇬🇧 The tier is set automatically from changed paths, not by human or AI judgement. Tier A is low-risk work like docs, translations and test-only changes, which can later auto-merge; tier B is normal business code and needs one human; tier C covers migrations, RLS, auth, tool permissions, state machines, prompts, money and approval policy, plus CI config, CLAUDE.md and CODEOWNERS, and needs a security review, passing evals and two humans. The key point: the agents' guardrails are all tier C, so agents can never change their own guardrails.

| 等级 · Tier | 路径 · Paths | 门槛 · Gates | 谁合并 · Who merges |
|---|---|---|---|
| **A 低 · Low** | 文档、翻译、纯测试、UI 文案、补丁级依赖 · Docs, translations, tests, copy, patch bumps | CI 绿 + 无高危发现 · CI green + no high findings | 自动（后期）· Auto (later) |
| **B 中 · Normal** | `src/app`、`src/domain`（非 RLS/权限）、`src/adapters` | CI + Agent 审查 + 改了 Agent 就跑评测 · + evals if agent paths change | 一个人 · One human |
| **C 高 · High** | 迁移、RLS、权限、工具权限、状态机、prompt、金钱与审批、`.github`、`CLAUDE.md`、`CODEOWNERS` | B 全部 + 安全审查 + 评测禁止动作为 0 且不降分 · + security review + evals | 两个人，一个是负责人 · Two humans, one owner |

### 4.4 工程 Agent 也分三级权限 · Engineering agents get three permission levels too

🇨🇳 和产品里的工具一样分三级：`read` 只能读代码、日志、issue 和评论；`auto` 可以推到自己的分支、开草稿 PR；`approval` 包括合并、跑迁移、部署、改 CI 或权限，必须人批。面试一句话："产品里 Agent 花钱要有审批记录，工程里 Agent 合并代码要有人批，是同一个思路。"
🇬🇧 Same three levels as the product's tools: `read` can read code, logs and issues and comment; `auto` can push to its own branch and open a draft PR; `approval` covers merging, running migrations, deploying and changing CI or permissions, and needs a human. One-liner: "In the product, an agent spending money needs an approval record; in engineering, an agent merging code needs a human. Same idea."

### 4.5 分阶段路线 · Staged roadmap (`ai-delivery.md`)

🇨🇳 每个阶段达到退出标准约两周后才进入下一阶段；每个阶段都能用一个标签关掉，这就是回滚。现在做完了阶段 0 和 1：人和 Claude Code 结对、确定性 CI、每晚评测、两个审查 Agent、风险标签、CODEOWNERS。之后依次是独立写测试的 Agent 和评测当 PR 门槛，再到人批准计划后由 Agent 写代码开草稿 PR，再到发布 Agent 自动迁移、部署和回滚，最后是运维闭环。决定做什么、批准计划、C 级改动、生产数据、故障指挥、客户沟通、改护栏，永远由人负责。
🇬🇧 Each stage moves on only after about two weeks meeting its exit criteria, and each can be switched off with one label, which is the rollback. Stages 0 and 1 are done: humans pairing with Claude Code, deterministic CI, nightly evals, two review agents, risk labels and CODEOWNERS. Next come an independent test-writing agent and evals as a PR gate, then agents coding from a human-approved plan into a draft PR, then a release agent that migrates, deploys and rolls back automatically, and finally an ops loop. Deciding what to build, approving plans, tier C changes, production data, incident command, customer conversations and changing the guardrails always stay with humans.

| 阶段 · Stage | 内容 · Content | 退出标准 · Exit criteria |
|---|---|---|
| **0（已完成 done）** | 人 + Claude Code；确定性 CI；每晚评测 · Pairing; deterministic CI; nightly evals | 量出基线：前置时间、审查时间、回滚率 · Baseline: lead time, review time, revert rate |
| **1（已完成 built）** | 两个审查 Agent；风险标签；CODEOWNERS；翻译检查 · Two reviewers; risk labels | ≥60% 发现有用；每周至少一个人漏掉的真 bug · ≥60% useful; one real bug a week |
| **2** | 写测试 Agent（**不看实现**）；变异测试；**评测当 PR 门槛** · Test writer (**doesn't see the code**); mutation testing; **evals as a PR gate** | 变异分不降；prompt 回归进不了 main · Mutation score holds; no prompt regression |
| **3** | 规划 Agent 写 issue → **人批计划** → 编码 Agent 沙箱写代码开草稿 PR · Plan → **human approves** → coder opens draft PR | ≥50% 小改即合并；回滚率不高于人 · ≥50% merge with small edits |
| **4** | 发布 Agent：迁移 → 部署 → 同步 → 健康检查 → 金丝雀，自动回滚；A 级自动合并 · Release agent with auto-rollback | 部署失败无需人工修 · No failed deploy needs manual fixing |
| **5** | 运维闭环：报警/纠错 → Agent 写失败测试复现 → 修复 PR → 值班人批 · Alert → failing test → fix PR → on-call approves | — |

### 4.6 本项目的 LLMOps · This project's LLMOps

🇨🇳 prompt 放在 `src/agent/*prompts.ts`，属于 C 级。每晚跑全量评测，阶段 2 会把 17 个场景的冒烟集变成 PR 门槛，用 `--max-cost` 封顶。"禁止动作必须为 0"是硬指标。模型 ID 写死、按步骤路由，换模型前先跑评测。线上 PM 点"标记错误"，`eval:harvest` 生成场景草稿，人审后进评测集。红队用模型写攻击、真 Agent 去跑、规则加评委打分。每个组织的模型路由可配置，有备用模型和熔断器。追踪走 OpenTelemetry 到 Langfuse，`llm_calls` 记录每次调用的成本。
🇬🇧 Prompts live in `src/agent/*prompts.ts` at tier C. The full eval suite runs nightly, and stage 2 makes the 17-scenario smoke set a PR gate, capped with `--max-cost`. "Forbidden actions must be 0" is a hard metric. Model IDs are pinned and routed per step, and evals run before any model switch. In production, a PM's "flag a mistake" goes through `eval:harvest` into draft scenarios, which a human reviews into the eval set. The red team has a model write attacks, runs them against the real agent, and scores them with rules plus a judge. Model routing is configurable per org, with a fallback model and a circuit breaker. Tracing goes through OpenTelemetry to Langfuse, and `llm_calls` records the cost of every call.

| 企业做法 · Practice | 本项目 · Here |
|---|---|
| Prompt 进版本控制 · Prompts in git | `src/agent/*prompts.ts`，C 级 · tier C |
| 评测门槛 · Eval gate | 每晚全量；阶段 2 冒烟集（17 场景）进 PR · Nightly; smoke set as PR gate in stage 2 |
| 禁止行为 · Forbidden behaviour | 禁止动作必须为 0 · Must be 0 |
| 固定模型版本 · Pinned models | 写死 ID、按步骤路由、换前先评测 · Exact IDs, per-step routing, evals first |
| 线上回流 · Production feedback | PM 标记错误 → `eval:harvest` → 人审 → 评测集 · Flag → harvest → review → eval set |
| 主动找错 · Finding failures | 红队 · Red team |
| 配置回滚 · Rollback by config | 每组织 `llm_routing`；备用模型 + 熔断器 · Fallback + circuit breaker |
| 追踪 · Tracing | OpenTelemetry → Langfuse；`llm_calls` 记成本 · records cost |

---

## 5. 常见面试题 · Common interview questions

**Q1：会让 AI 自动合并代码吗？· Would you let AI auto-merge code?**
🇨🇳 看风险等级。文档、测试这类低风险改动，在 CI 全绿、审查 Agent 没有高危发现、历史数据证明可靠后可以自动合并。碰数据库、权限、prompt、CI 的永远要人，而且 Agent 不能改自己的护栏。
🇬🇧 By risk tier. Low-risk changes like docs and tests can auto-merge once CI is green, the review agent has no high findings, and history shows the agent is reliable. Anything touching the database, permissions, prompts or CI always needs a human, and agents can't change their own guardrails.

**Q2：AI 审查和人工审查什么关系？· How does AI review relate to human review?**
🇨🇳 互补。确定性检查负责挡，AI 给建议，人做决定。AI 擅长不知疲倦地对照规则清单，人判断方向对不对。我们要求每个 AI 发现都有具体失败场景，并跟踪有用率，噪音太多大家就不看了。
🇬🇧 It complements it. Deterministic checks block, AI advises, humans decide. AI is good at applying a rule checklist tirelessly; humans judge whether the direction is right. Every AI finding needs a concrete failure scenario, and we track the useful rate, because too much noise makes people ignore it.

**Q3：怎么防止 CI 里的 Agent 被攻击？· How do you protect agents in CI from attack?**
🇨🇳 四点：PR 和 issue 文字不可信，发现注入就报告；fork PR 不给密钥，不用 `pull_request_target`；最小权限 token，云上用 OIDC；编码 Agent 在沙箱里跑，没有生产密钥。
🇬🇧 Four things: PR and issue text is untrusted, and injection is reported; fork PRs get no secrets and we don't use `pull_request_target`; least-privilege tokens and OIDC for cloud; coding agents run in sandboxes without production secrets.

**Q4：怎么保证改 prompt 是安全的？· How do you make sure a prompt change is safe?**
🇨🇳 prompt 像代码一样走 PR，属于最高风险等级；评测必须禁止动作为 0 且不降分；每晚跑全量；线上 PM 的纠错回流成新场景。以后新 prompt 先给一个客户用。
🇬🇧 Prompts go through PRs like code, at the highest risk tier; evals must show 0 forbidden actions and no score drop; the full set runs nightly; PM corrections flow back as new scenarios. Later, new prompts go to one customer first.

**Q5：怎么衡量 AI 用在交付上有没有效果？· How do you measure whether it works?**
🇨🇳 DORA 指标（前置时间、部署频率、变更失败率、恢复时间），加上 Agent 自己的指标：发现有用率、Agent PR 合并率、和人比的回滚率、每个合并 PR 的成本。阶段 0 量基线，每个阶段对比。
🇬🇧 DORA metrics (lead time, deployment frequency, change failure rate, time to restore) plus the agents' own: useful-finding rate, agent PR merge rate, revert rate vs humans, and cost per merged PR. Baseline at stage 0, compare at every stage.

**Q6：为什么写和审的 Agent 要分开？· Why separate the writing and reviewing agents?**
🇨🇳 同一个上下文的模型有同样的盲点。我们的审查 Agent 第一次运行就找到了作者漏掉的"永远不会失败的测试"。高风险改动甚至应该换一个模型来审。
🇬🇧 A model with the same context has the same blind spots. On its first run our reviewer found a "test that could never fail" the author had missed. High-risk changes should even use a different model to review.

**Q7：项目里还有什么是手动的？下一步做什么？· What's still manual, and what's next?**
🇨🇳 生产迁移和 Inngest 同步，曾经因为漏跑迁移导致 500。下一步是发布流水线：合并后迁移 → 部署 → 同步 → 健康检查，失败就回滚；然后把评测变成 PR 门槛。
🇬🇧 Production migrations and Inngest sync; a missed migration once caused a 500. Next is a release pipeline: after merge, migrate → deploy → sync → health check, with rollback on failure; then evals as a PR gate.

---

## 6. 30 秒总结 · 30-second summary

🇨🇳 "我用两种方式把 AI 用在交付上。第一，**Agent 做 CI/CD**：每个 PR 由两个独立 Agent 按项目规则审查，按路径自动分 A/B/C 风险等级，只有确定性检查能挡合并，由人决定；第一次运行就抓到作者漏掉的测试漏洞。第二，**AI 应用的 CI/CD**：prompt 和模型改动必须过评测、禁止动作为 0，线上纠错回流成测试。整体分阶段推进，数据证明安全才放权，Agent 永远不能改自己的护栏。"

🇬🇧 "I use AI in delivery in two ways. First, **agents doing CI/CD**: every PR is reviewed by two independent agents against the project rules, the change is tiered A/B/C by path automatically, only deterministic checks can block a merge, and a human decides; the first run caught a test hole the author missed. Second, **CI/CD for the AI app**: prompt and model changes must pass evals with zero forbidden actions, and production corrections flow back as tests. It advances in stages, autonomy is granted only when the data says it's safe, and agents can never change their own guardrails."
