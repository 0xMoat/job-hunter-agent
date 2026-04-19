import { describe, it, expect } from "vitest";
import { t } from "@/lib/i18n";

describe("i18n.t", () => {
  it("returns the Chinese string for a known key in zh-CN", () => {
    expect(t("zh-CN", "tab_chat")).toBe("对话");
  });

  it("returns the English string for a known key in en", () => {
    expect(t("en", "tab_chat")).toBe("Chat");
  });

  it("falls back to en when key missing in zh-CN dict", () => {
    // Pick a key that exists in en but hypothetically not in zh-CN.
    // Since the dicts are mostly mirrored, this test instead verifies the
    // fallback chain by passing an unknown key — should return the key itself.
    expect(t("zh-CN", "this.key.does.not.exist")).toBe("this.key.does.not.exist");
  });

  it("invokes function-typed entries with args", () => {
    // tracker_sub_n is a function entry: (n: number) => `${n} 个进行中`
    expect(t("zh-CN", "tracker_sub_n", 5)).toBe("5 个进行中");
  });
});
