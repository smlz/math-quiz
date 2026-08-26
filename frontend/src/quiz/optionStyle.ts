// Fixed A/B/C/D labels and colors for the 4 multiple-choice answer options
// (SPEC.md §3.1/§8). The mapping never changes between questions or
// sessions, so players learn the layout once and never need to re-read
// labels under time pressure.

export const OPTION_LABELS = ["A", "B", "C", "D"] as const;

export const OPTION_COLORS = ["#EF476F", "#118AB2", "#C79B33", "#06D6A0"] as const;

// Label/content text color per option, for contrast against OPTION_COLORS.
export const OPTION_TEXT_COLORS = ["#ffffff", "#ffffff", "#ffffff", "#ffffff"] as const;
