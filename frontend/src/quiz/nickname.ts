// Nicknames arrive from anyone holding a player token and end up on the
// projector, so the host cleans them before they enter the roster: a pupil
// must not be able to pass as a classmate ("Ada" next to "Ada" plus an
// invisible character), disguise text with direction overrides, or pile up
// combining marks.

/** Same limit as the join form's maxlength, which only binds honest clients. */
export const MAX_NICKNAME_LENGTH = 30;

// Control, format (zero-width characters, bidi overrides, BOM), private-use
// and unassigned code points: all invisible or meaningless on a name tag.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
// Two marks per letter covers real names (Vietnamese stacks two); more is
// "Zalgo" text spilling over its neighbours.
const EXCESS_MARKS = /(\p{M}{2})\p{M}+/gu;

const clean = (raw: string): string =>
  Array.from(
    raw
      // Folds look-alike forms such as fullwidth "Ａｄａ" into plain "Ada".
      .normalize("NFKC")
      .replace(INVISIBLE, "")
      .replace(EXCESS_MARKS, "$1")
      .replace(/\s+/gu, " ")
      .trim(),
  )
    .slice(0, MAX_NICKNAME_LENGTH)
    .join("")
    .trim();

const sameName = (name: string) => name.toLocaleLowerCase();

/** The roster version of `raw`, or null if nothing displayable is left.
 * A name already in `taken` (ignoring case) gets numbered: "Ada (2)". */
export function cleanNickname(raw: string, taken: Iterable<string>): string | null {
  const base = clean(raw);
  if (!base) return null;

  const takenNames = new Set(Array.from(taken, sameName));
  let nickname = base;
  for (let n = 2; takenNames.has(sameName(nickname)); n++) {
    const suffix = ` (${n})`;
    nickname = Array.from(base).slice(0, MAX_NICKNAME_LENGTH - suffix.length).join("").trim() + suffix;
  }
  return nickname;
}
