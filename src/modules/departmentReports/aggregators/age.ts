/**
 * Shared child/adult classification for membership reporting.
 *
 * A "child" matches the Membership Analytics children toggle: anyone under 18.
 * Classification is by year of birth (birth year within the last 18 years of
 * the reference year), so the member directory, analytics and the reports all
 * agree on who is a child. Members with no date of birth count as adults.
 */

/** Anyone whose age is below this at the reference date is a child. */
export const CHILD_AGE_LIMIT = 18;

/** Exact age at a date (used for age-group breakdowns). */
export const ageAt = (dob: Date, at: Date) => {
  const age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  return beforeBirthday ? age - 1 : age;
};

/**
 * Whether a member is a child as of `at`. By year of birth to stay consistent
 * with the analytics toggle; a missing date of birth counts as an adult.
 */
export const isChildBirthYear = (dob: Date | null | undefined, at: Date) =>
  !!dob && dob.getUTCFullYear() >= at.getUTCFullYear() - CHILD_AGE_LIMIT;
