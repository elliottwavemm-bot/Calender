/* Calendar contents, keyed by local date (YYYY-MM-DD).
 *
 *   n   name
 *   h   start hour as a decimal (12.5 = 12:30). Omit for an all-day entry.
 *   du  duration in hours. Only read when `h` is present.
 *   c   colour role — 'a' (accent, terracotta) or 'b' (accent-2, olive).
 */
window.INKLING_EVENTS = {
  '2026-08-03': [{ n: 'Team standup', h: 9, du: 1, c: 'a' }],
  '2026-08-04': [{ n: 'Design review', h: 13, du: 1.5, c: 'a' }, { n: 'Yoga class', h: 18, du: 1, c: 'b' }],
  '2026-08-06': [{ n: 'Lunch with Mint', h: 12.5, du: 1, c: 'b' }],
  '2026-08-08': [{ n: 'Weekend market', c: 'b' }],
  '2026-08-12': [{ n: 'Flight to Chiang Mai', h: 10.5, du: 2, c: 'a' }],
  '2026-08-14': [{ n: "Mom's birthday", c: 'a' }],
  '2026-08-18': [{ n: 'Dentist', h: 10.5, du: 1, c: 'b' }],
  '2026-08-21': [{ n: 'Project deadline', h: 17, du: 1, c: 'a' }],
  '2026-08-27': [{ n: 'Concert', h: 19.5, du: 2, c: 'a' }]
};
