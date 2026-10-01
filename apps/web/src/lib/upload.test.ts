import { MAX_SOURCE_BYTES, sha256Bytes } from "@char-pub/core";
import { expect, it, vi } from "vitest";
import { fakeClient } from "@/test/render";
import { UploadPendingError, uploadImage, uploadReferenceText } from "./upload";

const target = {
  upload: "upload-test",
  put_url: "https://upload.example.test/file",
  headers: {},
  expires_at: "2026-10-01T00:00:00Z",
};
const encoded = (text: string) => new TextEncoder().encode(text);

it("uploads reference text as the original UTF-8 bytes including BOM and CRLF", async () => {
  const bytes = encoded("\uFEFF# Title\r\nExact original text\r\n");
  const file = new File([bytes], "guide.md", { type: "" });
  const ready = {
    upload: target.upload,
    status: "ready" as const,
    blob: { digest: sha256Bytes(bytes), size: bytes.length, media_type: "text/markdown" },
  };
  const createUpload = vi.fn(async () => target);
  const putUpload = vi.fn(async (_target: unknown, _body: Blob) => {});
  const completeUpload = vi.fn(async () => ready);
  expect(
    await uploadReferenceText(fakeClient({ createUpload, putUpload, completeUpload }), file),
  ).toEqual({ ...ready.blob, format: "markdown" });
  expect(createUpload).toHaveBeenCalledWith({
    purpose: "asset",
    content_type: "text/markdown",
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  });
  const uploaded = putUpload.mock.calls[0]?.[1] as Blob | undefined;
  expect(uploaded?.type).toBe("text/markdown");
  if (!uploaded) throw new Error("Missing uploaded bytes");
  expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(bytes);
});

it.each([
  [new File([new Uint8Array([0xc3, 0x28])], "bad.txt", { type: "text/plain" }), "UTF-8"],
  [new File([encoded("A\u0000B")], "binary.md", { type: "text/markdown" }), "binary data"],
  [new File([""], "empty.txt", { type: "text/plain" }), "empty"],
  [new File([new Uint8Array(MAX_SOURCE_BYTES + 1)], "large.txt", { type: "text/plain" }), "8 MiB"],
  [new File(["not an image"], "wrong.png", { type: "image/png" }), "plain text"],
])("rejects an invalid reference file before requesting an upload", async (file, message) => {
  const createUpload = vi.fn(async () => target);
  await expect(uploadReferenceText(fakeClient({ createUpload }), file)).rejects.toThrow(message);
  expect(createUpload).not.toHaveBeenCalled();
});

it("does not accept changed reference bytes or a changed media type from the Registry", async () => {
  const file = new File(["original"], "notes.txt", { type: "text/plain" });
  const expected = { digest: sha256Bytes(encoded("original")), size: 8, media_type: "text/plain" };
  for (const patch of [
    { digest: sha256Bytes(encoded("changed")) },
    { size: 9 },
    { media_type: "image/webp" },
  ]) {
    await expect(
      uploadReferenceText(
        fakeClient({
          createUpload: async () => target,
          putUpload: async () => {},
          completeUpload: async () => ({
            upload: target.upload,
            status: "ready",
            blob: { ...expected, ...patch },
          }),
        }),
        file,
      ),
    ).rejects.toThrow("does not match");
  }
});

it("resumes an already processing upload without sending another copy", async () => {
  const file = new File(["wait"], "notes.txt", { type: "text/plain" });
  const createUpload = vi.fn(async () => target);
  const putUpload = vi.fn(async () => {});
  const completeUpload = vi.fn(async () => ({
    upload: target.upload,
    status: "processing" as const,
  }));
  const check = vi.fn(async () => ({
    upload: target.upload,
    status: "ready" as const,
    blob: { digest: sha256Bytes(encoded("wait")), size: 4, media_type: "text/plain" },
  }));
  const client = fakeClient({ createUpload, putUpload, completeUpload, upload: check });
  await expect(uploadReferenceText(client, file, { maxPolls: 0 })).rejects.toMatchObject({
    uploadId: target.upload,
  });
  expect(await uploadReferenceText(client, file, { resumeUpload: target.upload })).toMatchObject({
    format: "text",
  });
  expect(createUpload).toHaveBeenCalledTimes(1);
  expect(putUpload).toHaveBeenCalledTimes(1);
  expect(completeUpload).toHaveBeenCalledTimes(1);
  expect(check).toHaveBeenCalledWith(target.upload);
});

it("stops subsequent upload steps after cancellation even if the in-flight PUT completes", async () => {
  const controller = new AbortController();
  let finish: () => void = () => {};
  const sent = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const putUpload = vi.fn(() => sent);
  const completeUpload = vi.fn();
  const running = uploadReferenceText(
    fakeClient({ createUpload: async () => target, putUpload, completeUpload }),
    new File(["text"], "notes.txt", { type: "text/plain" }),
    { signal: controller.signal },
  );
  const rejected = expect(running).rejects.toMatchObject({ name: "UploadCancelledError" });
  await vi.waitFor(() => expect(putUpload).toHaveBeenCalledTimes(1));
  controller.abort();
  finish();
  await rejected;
  expect(completeUpload).not.toHaveBeenCalled();
});

it("retains image validation and accepts the server's normalized image result", async () => {
  const createUpload = vi.fn(async () => target);
  const bytes = encoded("image input is normalized by the server");
  const normalized = {
    digest: sha256Bytes(encoded("server webp")),
    size: 11,
    media_type: "image/webp",
  };
  const client = fakeClient({
    createUpload,
    putUpload: async () => {},
    completeUpload: async () => ({ upload: target.upload, status: "ready", blob: normalized }),
  });
  await expect(uploadImage(client, new Blob([bytes], { type: "text/plain" }))).rejects.toThrow(
    "PNG, JPEG",
  );
  expect(createUpload).not.toHaveBeenCalled();
  expect(await uploadImage(client, new Blob([bytes], { type: "image/png" }))).toEqual(normalized);
  expect(createUpload).toHaveBeenCalledWith({
    purpose: "asset",
    content_type: "image/png",
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  });
});

it("retains a pending receipt if completion acknowledgement is lost", async () => {
  const file = new File(["original"], "notes.txt", { type: "text/plain" });
  await expect(
    uploadReferenceText(
      fakeClient({
        createUpload: async () => target,
        putUpload: async () => {},
        completeUpload: async () => {
          throw new Error("offline");
        },
      }),
      file,
    ),
  ).rejects.toBeInstanceOf(UploadPendingError);
});

it("does not start an upload after account authority changes during file reading", async () => {
  const file = new File(["private text"], "notes.txt", { type: "text/plain" });
  let finish!: (value: ArrayBuffer) => void;
  let current = true;
  vi.spyOn(file, "arrayBuffer").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const createUpload = vi.fn();
  const result = uploadReferenceText(fakeClient({ createUpload }), file, {
    isCurrent: () => current,
  });
  const rejected = expect(result).rejects.toMatchObject({ name: "UploadCancelledError" });
  current = false;
  finish(new ArrayBuffer(12));
  await rejected;
  expect(createUpload).not.toHaveBeenCalled();
});

it("does not send file bytes after account authority changes while reserving an upload", async () => {
  const file = new File(["private text"], "notes.txt", { type: "text/plain" });
  let finish!: (value: typeof target) => void;
  let current = true;
  const createUpload = vi.fn(
    () =>
      new Promise<typeof target>((resolve) => {
        finish = resolve;
      }),
  );
  const putUpload = vi.fn(),
    completeUpload = vi.fn();
  const result = uploadReferenceText(
    fakeClient({ createUpload, putUpload, completeUpload }),
    file,
    { isCurrent: () => current },
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "UploadCancelledError" });
  await vi.waitFor(() => expect(createUpload).toHaveBeenCalledTimes(1));
  current = false;
  finish(target);
  await rejected;
  expect(putUpload).not.toHaveBeenCalled();
  expect(completeUpload).not.toHaveBeenCalled();
});
