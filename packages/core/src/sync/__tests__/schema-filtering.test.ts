import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = {
  execute: mockExecute,
  select: mockSelect,
  close: vi.fn(),
};

const dbMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  ensureNoTransaction: vi.fn(),
  cleanupOrphanedSyncRows: vi.fn(),
  getDeviceId: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);

vi.mock("../../db/write-retry", () => ({
  runSerializedDbTask: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: vi.fn(() => ({
    isDesktop: false,
  })),
}));

const { applyChanges } = await import("../simple-sync");
const { applyRemoteDelta } = await import("../incremental-sync");

describe("sync schema filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getDB.mockResolvedValue(mockDb);
    dbMocks.ensureNoTransaction.mockResolvedValue(undefined);
    dbMocks.cleanupOrphanedSyncRows.mockResolvedValue(undefined);
    dbMocks.getDeviceId.mockResolvedValue("device-local");

    mockSelect.mockImplementation(async (sql: string) => {
      if (sql.startsWith("PRAGMA table_info(books)")) {
        return [
          { name: "id" },
          { name: "title" },
          { name: "updated_at" },
          { name: "sync_version" },
          { name: "last_modified_by" },
        ];
      }

      if (sql.startsWith("SELECT id AS id, updated_at AS timestamp FROM books")) {
        return [];
      }

      if (sql.startsWith("SELECT updated_at FROM books WHERE id = ?")) {
        return [];
      }

      return [];
    });
    mockExecute.mockResolvedValue(undefined);
  });

  it("simple sync ignores unknown remote columns", async () => {
    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: Date.now(),
      since: 0,
      tables: {
        books: {
          records: [
            {
              id: "book-1",
              title: "Test Book",
              updated_at: 1000,
              reading_status: "reading",
            },
          ],
          deletedIds: [],
        },
      },
    });

    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(mockExecute).toHaveBeenCalled();

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("INSERT INTO books (id, title, updated_at)");
    expect(sql).not.toContain("reading_status");
    expect(params).toEqual(["book-1", "Test Book", 1000]);
  });

  it("incremental sync ignores unknown remote columns", async () => {
    const result = await applyRemoteDelta({
      deviceId: "device-remote",
      fromTimestamp: 0,
      toTimestamp: Date.now(),
      tables: {
        books: {
          table: "books",
          records: [
            {
              id: "book-2",
              title: "Another Book",
              updated_at: 2000,
              reading_status: "finished",
            },
          ],
          deletedIds: [],
        },
      },
    });

    expect(result.applied).toBe(1);
    expect(result.conflicts).toBe(0);

    const insertCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO books"),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall?.[0]).not.toContain("reading_status");
    expect(insertCall?.[1]).toEqual(["book-2", "Another Book", 2000]);
  });
});
