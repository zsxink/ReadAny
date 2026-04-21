import { describe, expect, it } from "vitest";

import {
  getWebDavImportRootPrefix,
  resolveWebDavImportServerPath,
  toWebDavImportRelativePath,
} from "./webdav-import-service";
import type { WebDavImportSource } from "./webdav-import-types";

function createSource(overrides: Partial<WebDavImportSource> = {}): WebDavImportSource {
  return {
    kind: "saved",
    url: "https://dav.example.com",
    username: "demo",
    password: "secret",
    remoteRoot: "readany",
    ...overrides,
  };
}

describe("webdav import path helpers", () => {
  it("builds root prefix when url does not include remote root", () => {
    const source = createSource({
      url: "https://dav.example.com/library",
      remoteRoot: "readany",
    });

    expect(getWebDavImportRootPrefix(source)).toBe("/library/readany");
    expect(resolveWebDavImportServerPath(source, "/books")).toBe("/library/readany/books");
  });

  it("dedupes root prefix when url already includes remote root", () => {
    const source = createSource({
      url: "https://dav.example.com/library/readany",
      remoteRoot: "readany",
    });

    expect(getWebDavImportRootPrefix(source)).toBe("/library/readany");
    expect(resolveWebDavImportServerPath(source, "/")).toBe("/library/readany");
  });

  it("maps server hrefs back to browser relative paths", () => {
    const source = createSource({
      url: "https://dav.example.com/library/readany",
      remoteRoot: "readany",
    });

    expect(toWebDavImportRelativePath(source, "/library/readany")).toBe("/");
    expect(toWebDavImportRelativePath(source, "/library/readany/fiction/book.epub")).toBe(
      "/fiction/book.epub",
    );
    expect(
      toWebDavImportRelativePath(
        source,
        "https://dav.example.com/library/readany/non-fiction/essay.pdf",
      ),
    ).toBe("/non-fiction/essay.pdf");
  });

  it("uses the URL pathname as root when remote root is blank", () => {
    const source = createSource({
      url: "https://dav.example.com/library",
      remoteRoot: "",
    });

    expect(getWebDavImportRootPrefix(source)).toBe("/library");
    expect(resolveWebDavImportServerPath(source, "/fiction/book.epub")).toBe(
      "/library/fiction/book.epub",
    );
  });
});
