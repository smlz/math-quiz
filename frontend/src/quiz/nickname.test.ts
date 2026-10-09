import { describe, expect, it } from "vitest";
import { cleanNickname, MAX_NICKNAME_LENGTH } from "./nickname";

// Invisible characters are spelled out by code point so the test source
// stays readable.
const cp = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const ZERO_WIDTH_SPACE = cp(0x200b);
const ZERO_WIDTH_NON_JOINER = cp(0x200c);
const BYTE_ORDER_MARK = cp(0xfeff);
const RIGHT_TO_LEFT_OVERRIDE = cp(0x202e);
const BELL = cp(0x07);
const IDEOGRAPHIC_SPACE = cp(0x3000);
const COMBINING_STROKES = cp(0x336, 0x337, 0x338, 0x334, 0x335);

describe("cleanNickname", () => {
  it("keeps an ordinary name", () => {
    expect(cleanNickname("  Ada Lovelace ", [])).toBe("Ada Lovelace");
  });

  it("keeps accents, other scripts and emoji", () => {
    expect(cleanNickname("Zoë", [])).toBe("Zoë");
    expect(cleanNickname("Nguyễn", [])).toBe("Nguyễn");
    expect(cleanNickname("Αθηνά", [])).toBe("Αθηνά");
    expect(cleanNickname("Bo 🦊", [])).toBe("Bo 🦊");
  });

  it("strips invisible and direction-override characters", () => {
    expect(cleanNickname(`A${ZERO_WIDTH_SPACE}d${ZERO_WIDTH_NON_JOINER}a${BYTE_ORDER_MARK}`, [])).toBe("Ada");
    expect(cleanNickname(`${RIGHT_TO_LEFT_OVERRIDE}gnorw si rehcaeT`, [])).toBe("gnorw si rehcaeT");
    expect(cleanNickname(`Ada${BELL}`, [])).toBe("Ada");
  });

  it("folds look-alike compatibility characters", () => {
    expect(cleanNickname("Ａｄａ", [])).toBe("Ada");
  });

  it("caps stacked combining marks", () => {
    expect(cleanNickname(`Z${COMBINING_STROKES}x`, [])).toBe(`Z${COMBINING_STROKES.slice(0, 2)}x`);
  });

  it("collapses whitespace", () => {
    expect(cleanNickname(`Ada${cp(0x0a, 0x09)}  ${IDEOGRAPHIC_SPACE}Lovelace`, [])).toBe("Ada Lovelace");
  });

  it("returns null when nothing displayable is left", () => {
    expect(cleanNickname("   ", [])).toBeNull();
    expect(cleanNickname(`${ZERO_WIDTH_SPACE}${RIGHT_TO_LEFT_OVERRIDE}`, [])).toBeNull();
  });

  it("truncates to the length limit", () => {
    expect(Array.from(cleanNickname("x".repeat(500), [])!)).toHaveLength(MAX_NICKNAME_LENGTH);
  });

  it("numbers a name that is already taken, ignoring case and tricks", () => {
    expect(cleanNickname("Ada", ["Ada"])).toBe("Ada (2)");
    expect(cleanNickname("ada", ["Ada", "Ada (2)"])).toBe("ada (3)");
    expect(cleanNickname(`Ada${ZERO_WIDTH_SPACE}`, ["Ada"])).toBe("Ada (2)");
  });

  it("keeps a numbered name within the length limit", () => {
    const long = "y".repeat(MAX_NICKNAME_LENGTH);
    const numbered = cleanNickname(long, [long])!;
    expect(numbered.endsWith(" (2)")).toBe(true);
    expect(Array.from(numbered)).toHaveLength(MAX_NICKNAME_LENGTH);
  });
});
