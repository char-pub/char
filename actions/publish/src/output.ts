/** Write the runner's output protocol through one open descriptor, never check then reopen a path. */
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, writeFileSync } from "node:fs";
import { EOL } from "node:os";

export function setOutput(name: string, value: string, file = process.env.GITHUB_OUTPUT): void {
  if (!file) throw new Error("GITHUB_OUTPUT is required");
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new Error("invalid output name");
  const delimiter = `char_pub_${randomUUID()}`;
  if (value.includes(delimiter)) throw new Error("output delimiter appears in value");
  // Do not create a missing runner file or follow a symlink swapped in by another process.
  const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("GITHUB_OUTPUT must be a regular file");
    writeFileSync(fd, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`, "utf8");
  } finally {
    closeSync(fd);
  }
}
