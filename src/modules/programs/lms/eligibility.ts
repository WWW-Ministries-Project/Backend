/**
 * Who may join a program without review. Pure so it can be unit-tested.
 *
 * Program flags are stored on `program` but were never enforced server-side:
 * - member_required:   the person is a member (not a guest)
 * - leader_required:   the person heads a department or holds a church position
 * - ministry_required: the person serves in at least one department
 */
export type EligibilityInput = {
  program: { member_required: boolean; leader_required: boolean; ministry_required: boolean };
  person: { isGuest: boolean; isLeader: boolean; inMinistry: boolean };
  incompletePrerequisites: string[];
  seats: { enrolled: number; capacity: number } | null;
};

export const eligibilityReasons = (input: EligibilityInput): string[] => {
  const reasons: string[] = [];
  if (input.program.member_required && input.person.isGuest) reasons.push("Not a church member");
  if (input.program.leader_required && !input.person.isLeader) reasons.push("Not a leader");
  if (input.program.ministry_required && !input.person.inMinistry) reasons.push("Not serving in a ministry");
  if (input.incompletePrerequisites.length) {
    reasons.push(`Has not completed ${input.incompletePrerequisites.join(", ")}`);
  }
  // Same rule as EnrollmentService.enrollUser: capacity is a hard limit.
  if (input.seats && input.seats.enrolled >= input.seats.capacity) {
    reasons.push(`Class is full (${input.seats.enrolled} / ${input.seats.capacity})`);
  }
  return reasons;
};
