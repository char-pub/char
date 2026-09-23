/**
 * 审计记录的 before / after 对比。按字段逐项列出：新增、删除、修改的字段分别标出，
 * 值用 JSON 文本显示（纯文本，不解释任何标记）。
 */

type Row = {
  key: string;
  before?: string;
  after?: string;
  change: "added" | "removed" | "changed" | "same";
};

function flatten(
  v: unknown,
  prefix = "",
  out: Map<string, string> = new Map(),
): Map<string, string> {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, "{}");
    for (const [k, val] of entries) flatten(val, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  if (prefix || v !== null) out.set(prefix || "(value)", JSON.stringify(v));
  return out;
}

export function diffRows(before: unknown, after: unknown): Row[] {
  const b = flatten(before);
  const a = flatten(after);
  const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
  return keys.map((key) => {
    const bv = b.get(key);
    const av = a.get(key);
    const change: Row["change"] =
      bv === undefined ? "added" : av === undefined ? "removed" : bv === av ? "same" : "changed";
    const row: Row = { key, change };
    if (bv !== undefined) row.before = bv;
    if (av !== undefined) row.after = av;
    return row;
  });
}

const MARK: Record<Row["change"], string> = {
  added: "text-ok",
  removed: "text-danger",
  changed: "text-signal-ink",
  same: "text-muted-foreground",
};

export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = diffRows(before, after);
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground">No field changes recorded.</p>;
  return (
    <table className="data-table font-mono text-xs" aria-label="Field changes">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td className="break-all">{r.before ?? "—"}</td>
            <td className="break-all">{r.after ?? "—"}</td>
            <td className={MARK[r.change]}>{r.change}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
