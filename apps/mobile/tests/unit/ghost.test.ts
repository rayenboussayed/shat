import { describe, it, expect, vi } from "vitest";
import { GhostModeController, GHOST_MODE_DEFAULT, isGhostModeEnabled } from "../../src/ghost/controller.ts";

describe("ghost mode", () => {
  it("defaults to on", () => {
    expect(GHOST_MODE_DEFAULT).toBe(true);
    expect(isGhostModeEnabled(undefined)).toBe(true);
    const controller = new GhostModeController();
    expect(controller.isDefaultEnabled).toBe(true);
    expect(controller.isEnabled).toBe(true);
  });

  it("keeps content in memory and clears on close", () => {
    const controller = new GhostModeController();
    controller.store("c1", "secret");
    expect(controller.read("c1")).toHaveLength(1);
    controller.closeConversation("c1");
    expect(controller.read("c1")).toHaveLength(0);
  });

  it("returns a shallow copy from read", () => {
    const controller = new GhostModeController();
    controller.store("c1", "secret");
    const first = controller.read("c1");
    const second = controller.read("c1");
    expect(first).not.toBe(second);
    expect([...first]).toEqual([...second]);
  });

  it("clears all content on app background", () => {
    const controller = new GhostModeController();
    controller.store("c1", "secret");
    controller.store("c2", "other");
    controller.handleAppBackground();
    expect(controller.read("c1")).toHaveLength(0);
    expect(controller.read("c2")).toHaveLength(0);
  });

  it("clears via lifecycle hook on background", () => {
    const callbacks: (() => void)[] = [];
    const lifecycle = {
      onBackground: (callback: () => void) => {
        callbacks.push(callback);
        return () => {
          const index = callbacks.indexOf(callback);
          if (index >= 0) {
            callbacks.splice(index, 1);
          }
        };
      },
    };
    const controller = new GhostModeController({ lifecycle });
    controller.store("c1", "secret");
    callbacks[0]?.();
    expect(controller.read("c1")).toHaveLength(0);
  });

  it("does not buffer content when disabled", () => {
    const controller = new GhostModeController();
    controller.disable();
    controller.store("c1", "secret");
    expect(controller.read("c1")).toHaveLength(0);
  });

  it("clears volatile buffer on persistent mode switch", () => {
    const controller = new GhostModeController();
    controller.store("c1", "secret");
    controller.enablePersistentMode({ insert: vi.fn() });
    expect(controller.read("c1")).toHaveLength(0);
    controller.store("c1", "again");
    controller.disablePersistentMode();
    expect(controller.read("c1")).toHaveLength(0);
  });

  it("throws persistEnvelope before opt-in", async () => {
    const controller = new GhostModeController();
    await expect(controller.persistEnvelope("c1", "env")).rejects.toThrow();
  });

  it("does not invoke persistent store while buffering in ghost mode", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const controller = new GhostModeController();
    controller.enablePersistentMode({ insert });
    controller.disablePersistentMode();
    controller.enable();
    controller.store("c1", "secret");
    expect(insert).not.toHaveBeenCalled();
  });

  it("clears volatile buffer on dispose", () => {
    const controller = new GhostModeController();
    controller.store("c1", "secret");
    controller.dispose();
    expect(controller.read("c1")).toHaveLength(0);
  });
});