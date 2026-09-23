# `@commons` 种子内容

这个目录是 `@commons` namespace 的种子内容草稿：12 个 World、12 个 Lorebook，以及一个引用它们的示例 Character（`examples/wren-the-harbor-guide`）。

- **来源**：AI 辅助起草的原创内容，每个 Creation 的 `provenance.authored_by_agent` 都是 `true`。
- **许可**：全部是 `CC0-1.0`，评级 `general`，署名 `char.pub commons`。
- **状态**：**尚未发布**。内容要先经过人工逐条审校（见 [REVIEW.md](REVIEW.md)），审校通过后才会发布到 `@commons`。审校中发现的问题直接修改对应的 `char.yaml`。

## 目录结构

每个 Creation 一个目录，里面是一个 `char.yaml`（Canonical Creation 的 YAML 表示）。World 与 Lorebook 没有依赖；示例 Character 用 `pin: { follow: latest }` 引用 `@commons/saltmere`、`@commons/saltmere-guilds` 与 `@commons/weather-and-seasons`，发布时由 Registry 固定到具体的 Release。

## 校验

```sh
pnpm commons:check                         # 按依赖顺序模拟发布，对每个 Creation 运行发布校验
pnpm commons:check --json                  # 输出完整结果（REVIEW.md 中的 digest 由它生成）
pnpm commons:check --snapshots /tmp/snap   # 另外写出 Release 快照，便于本地 build / preview
```

`pnpm commons:check` 做的事：

- 用与 Registry 相同的发布校验检查每个 Creation；
- 依赖的 pin 固定到本地模拟发布的 Release；
- 不把任何 namespace 当作同一权利人，所以种子内容必须是任何人都能再分发的；
- 另外检查种子内容自己的约定：许可为 CC0-1.0、评级为 general、署名包含 `char.pub commons`、正文里没有链接或邮箱地址。

任何一项失败都会以非零状态退出。

用 `--snapshots` 写出快照之后，可以在本地预览示例角色：

```sh
S=/tmp/snap
node packages/cli/dist/bin.js preview -f $S/wren-the-harbor-guide.pinned.yaml \
  --dep $S/saltmere.release.json --dep $S/saltmere-guilds.release.json \
  --dep $S/weather-and-seasons.release.json -m "Where can I find a pilot?"
```

（先运行 `pnpm --filter @char-pub/cli build`。）
