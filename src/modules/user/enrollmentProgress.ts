/**
 * Program progress for one enrollment, as exposed on `GET /user/get-user`
 * (`enrolled_programs.items[].progress_percent / completed_topics / total_topics`).
 *
 * Mirrors the learner portal / program admin logic: a topic counts as done when
 * its progress row is `completed` or `status === "PASS"`, only topics that
 * belong to the enrollment's program count, and the percent is rounded to an
 * integer. A completed enrollment always reports 100.
 */
export type EnrollmentProgressRow = {
  topicId: number;
  completed: boolean | null;
  status: string | null;
  topicProgramId?: number | null;
};

export const computeEnrollmentProgress = (args: {
  programId: number | null;
  totalTopics: number;
  progress: EnrollmentProgressRow[];
  enrollmentCompleted: boolean | null | undefined;
}) => {
  const totalTopics = Math.max(0, Math.floor(Number(args.totalTopics) || 0));
  const doneTopicIds = new Set<number>();

  for (const row of args.progress || []) {
    if (!row) continue;
    const isDone = row.completed === true || row.status === "PASS";
    if (!isDone) continue;
    if (
      args.programId !== null &&
      row.topicProgramId !== undefined &&
      row.topicProgramId !== args.programId
    ) {
      continue;
    }
    doneTopicIds.add(row.topicId);
  }

  const completedTopics = Math.min(doneTopicIds.size, totalTopics);
  const progressPercent = args.enrollmentCompleted
    ? 100
    : totalTopics > 0
      ? Math.min(100, Math.round((completedTopics / totalTopics) * 100))
      : 0;

  return {
    progress_percent: progressPercent,
    completed_topics: completedTopics,
    total_topics: totalTopics,
  };
};
