import {describe, expect, it, vi} from "vitest";

const ULID_A = "01M43R3ZGSNXQ0KSMZ9JSZEZ5W";
const ULID_B = "01M43R3YYCBWXD01XW1RXPM575";

vi.mock("./i18n", () => ({
  default: {t: (key: string) => key},
}));

vi.mock("../store/harnessStore", () => ({
  useHarnessStore: {
    getState: () => ({
      resolveFor: (_dir: string, ulid: string) =>
        ulid === ULID_A
          ? {status: "found", repoRoot: "C:/repo", entry: {ulid, path: "a.md", title: "План А", type: "plan"}}
          : ulid.startsWith("01M43R")
            ? {status: "ambiguous"}
            : {status: "unknown"},
    }),
    subscribe: () => () => {},
  },
  openUlidTarget: vi.fn(),
}));

import {buildEnvelopeLinkChips} from "./harnessLinks";
import {parseHarnessEnvelope} from "./harnessEnvelope";

describe("buildEnvelopeLinkChips", () => {
  const envelope = parseHarnessEnvelope(
    [
      "<!-- [<[harness-yaml]]",
      `id: ${ULID_A}`,
      `related: [${ULID_B}, 01M5RK385592V1WEET1786GDFN]`,
      `based_on: [${ULID_A}]`,
      "[[harness-yaml]>] -->",
    ].join("\n"),
  )!;

  it("based_on первыми, известные — title, неизвестные — ULID", () => {
    const chips = buildEnvelopeLinkChips(envelope, "C:/repo/docs");
    expect(chips.map((c) => c.kind)).toEqual(["based", "related", "related"]);
    expect(chips[0]).toMatchObject({ulid: ULID_A, label: "План А", title: "План А · plan", known: true});
    expect(chips[1]).toMatchObject({ulid: ULID_B, label: ULID_B, title: "harness.ulidUnknownTooltip", known: false});
  });

  it("ambiguous трактуется как неизвестный (тихий чип)", () => {
    // ULID_B начинается с 01M43R -> ambiguous в стабе
    const chips = buildEnvelopeLinkChips(envelope, "C:/repo/docs");
    expect(chips.find((c) => c.ulid === ULID_B)?.known).toBe(false);
  });
});
