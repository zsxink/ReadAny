import type { ReadingSession } from "../../types/reading";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
}));

vi.mock("../db-core", () => coreMocks);

const {
  getReadingSessions,
  getReadingSessionsByDateRange,
  insertReadingSession,
  updateReadingSession,
} = await import("../session-queries");

const sampleSession: ReadingSession = {
  id: "session-1",
  bookId: "book-1",
  startedAt: 1000,
  endedAt: 2000,
  totalActiveTime: 900,
  pagesRead: 10,
  state: "completed",
};

describe("session-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.nextUpdatedAt.mockResolvedValue(3000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getReadingSessions", () => {
    it("returns mapped sessions for a specific book", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "session-1",
          book_id: "book-1",
          started_at: 1000,
          ended_at: 2000,
          total_active_time: 900,
          pages_read: 10,
          state: "completed",
        },
      ]);

      const sessions = await getReadingSessions("book-1");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("session-1");
      expect(sessions[0].bookId).toBe("book-1");
      expect(sessions[0].startedAt).toBe(1000);
      expect(sessions[0].endedAt).toBe(2000);
      expect(sessions[0].totalActiveTime).toBe(900);
      expect(sessions[0].pagesRead).toBe(10);
      expect(sessions[0].state).toBe("completed");
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM reading_sessions WHERE book_id = ? ORDER BY started_at DESC",
        ["book-1"],
      );
    });

    it("handles null ended_at", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "session-2",
          book_id: "book-1",
          started_at: 3000,
          ended_at: null,
          total_active_time: 120,
          pages_read: 2,
          state: "active",
        },
      ]);

      const sessions = await getReadingSessions("book-1");
      expect(sessions[0].endedAt).toBeUndefined();
      expect(sessions[0].state).toBe("active");
    });
  });

  describe("getReadingSessionsByDateRange", () => {
    it("queries with date range parameters", async () => {
      mockSelect.mockResolvedValue([]);

      const start = new Date("2024-01-01T00:00:00Z");
      const end = new Date("2024-01-31T23:59:59Z");

      await getReadingSessionsByDateRange(start, end);
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM reading_sessions WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC",
        [start.getTime(), end.getTime()],
      );
    });
  });

  describe("insertReadingSession", () => {
    it("inserts session with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertReadingSession(sampleSession);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "reading_sessions");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO reading_sessions");
      expect(params[0]).toBe("session-1");
      expect(params[1]).toBe("book-1");
      expect(params[2]).toBe(1000); // startedAt
      expect(params[3]).toBe(2000); // endedAt
      expect(params[4]).toBe(900);  // totalActiveTime
      expect(params[5]).toBe(10);   // pagesRead
      expect(params[6]).toBe("completed"); // state
    });
  });

  describe("updateReadingSession", () => {
    it("updates endedAt and state", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateReadingSession("session-1", { endedAt: 5000, state: "completed" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE reading_sessions SET");
      expect(sql).toContain("ended_at = ?");
      expect(sql).toContain("state = ?");
      expect(params).toContain(5000);
      expect(params).toContain("completed");
    });

    it("updates totalActiveTime and pagesRead", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateReadingSession("session-1", { totalActiveTime: 1800, pagesRead: 25 });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("total_active_time = ?");
      expect(sql).toContain("pages_read = ?");
      expect(params).toContain(1800);
      expect(params).toContain(25);
    });

    it("does nothing when no updates provided", async () => {
      await updateReadingSession("session-1", {});
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("always includes sync tracking fields when updating", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateReadingSession("session-1", { pagesRead: 5 });
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("updated_at = ?");
      expect(sql).toContain("sync_version = ?");
      expect(sql).toContain("last_modified_by = ?");
    });
  });
});
