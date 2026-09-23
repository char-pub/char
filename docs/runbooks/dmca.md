# Runbook：DMCA 与其他法律下架请求

适用于 DMCA 通知、法院命令、GDPR 删除请求以及其他法律依据的下架请求。处理人：legal 角色（或 owner）。

## 1. 登记

在 admin 的“法律请求”页面新建记录：

- 类型：`dmca` / `court` / `gdpr` / `other`；
- 申请人信息（加密存储，只有 legal 可读）；
- 收到日期、法定或承诺的截止日期；
- 涉及的对象：URL、`@namespace/name@label`、或 fragment 引用。

## 2. 评估

DMCA 通知需要具备法定要素：权利人签名、被侵权作品说明、涉嫌侵权内容的位置、联系方式、善意声明、准确性与授权声明。缺要素时回复申请人补充，不执行下架。

GDPR 删除请求先核实请求人身份与数据的关联。

## 3. 预览影响范围

在 admin 中选择下架对象，执行 dry-run，确认：

- 所有包含该内容的 Release（包括把它放在依赖闭包中的下游 Release）；
- 会失效的 IR、导出物、缩略图与 CDN URL；
- 受影响的下游作者。

影响超过 50 个 Release 时需要**四眼确认**。

## 4. 执行 tombstone

选择原因代码（公开可见）：

| 原因代码 | 用途 |
|---|---|
| `legal.dmca` | DMCA 通知 |
| `legal.court_order` | 法院命令 |
| `legal.gdpr` | GDPR 删除 |
| `policy.minor_sexual` | 涉及未成年人的性内容（走 [CSAM 预案](csam-hit.md)） |
| `policy.illegal` | 其他违法内容 |
| `policy.non_consensual` | 未经同意的私密内容 |
| `policy.malware` | 恶意内容 |
| `author.request` | 作者自己请求删除 |

执行后系统会：把受影响的 Release 设为 tombstoned、相关对象设为 withheld、写入内容黑名单与审计；worker 删除可分发副本并清除 CDN 缓存。在 admin 中确认核验任务显示所有 URL 已返回 404。

## 5. 通知

- 通知作者：只告知原因代码和反通知的方法，不透露申请人信息。
- 通知受影响的下游作者：他们的 Release 也被 tombstone 了，需要移除依赖后重新发布。
- 回复申请人：已处理。

## 6. 反通知（DMCA）

作者提交反通知后：

1. legal 核对反通知的法定要素；
2. 把反通知转给原申请人，告知 10–14 个工作日后恢复，除非对方提起诉讼；
3. 期满且未收到诉讼通知时，在对象仍处于 withheld（未 purge）的前提下恢复。恢复是运营例外，需要 owner 加四眼确认，并写审计。

## 7. 记录

所有步骤都会自动写入审计日志。额外在法律请求记录中写明处理结论和日期，供 EU DSA 透明度报告使用。
