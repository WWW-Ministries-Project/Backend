import { prisma } from "../../Models/context";

export const FAMILY_RELATION = {
  SPOUSE: "SPOUSE",
  PARENT: "PARENT",
  CHILD: "CHILD",
  SIBLING: "SIBLING",
  GUARDIAN: "GUARDIAN",
  DEPENDENT: "DEPENDENT",
  GRANDPARENT: "GRANDPARENT",
  GRANDCHILD: "GRANDCHILD",
  IN_LAW: "IN_LAW",
} as const;

export type FamilyRelationType =
  (typeof FAMILY_RELATION)[keyof typeof FAMILY_RELATION];

const INPUT_TO_RELATION: Record<string, FamilyRelationType> = {
  spouse: FAMILY_RELATION.SPOUSE,
  wife: FAMILY_RELATION.SPOUSE,
  husband: FAMILY_RELATION.SPOUSE,

  parent: FAMILY_RELATION.PARENT,
  father: FAMILY_RELATION.PARENT,
  mother: FAMILY_RELATION.PARENT,

  child: FAMILY_RELATION.CHILD,
  children: FAMILY_RELATION.CHILD,
  son: FAMILY_RELATION.CHILD,
  daughter: FAMILY_RELATION.CHILD,
  kid: FAMILY_RELATION.CHILD,
  ward: FAMILY_RELATION.CHILD,

  sibling: FAMILY_RELATION.SIBLING,
  siblings: FAMILY_RELATION.SIBLING,
  brother: FAMILY_RELATION.SIBLING,
  sister: FAMILY_RELATION.SIBLING,
  bro: FAMILY_RELATION.SIBLING,
  sis: FAMILY_RELATION.SIBLING,
  sibs: FAMILY_RELATION.SIBLING,

  guardian: FAMILY_RELATION.GUARDIAN,
  dependent: FAMILY_RELATION.DEPENDENT,

  grandparent: FAMILY_RELATION.GRANDPARENT,
  grandmother: FAMILY_RELATION.GRANDPARENT,
  grandfather: FAMILY_RELATION.GRANDPARENT,

  grandchild: FAMILY_RELATION.GRANDCHILD,
  granddaughter: FAMILY_RELATION.GRANDCHILD,
  grandson: FAMILY_RELATION.GRANDCHILD,

  "in-law": FAMILY_RELATION.IN_LAW,
  "in law": FAMILY_RELATION.IN_LAW,
  in_law: FAMILY_RELATION.IN_LAW,
  inlaw: FAMILY_RELATION.IN_LAW,
};

const RECIPROCAL_RELATION: Record<FamilyRelationType, FamilyRelationType> = {
  [FAMILY_RELATION.SPOUSE]: FAMILY_RELATION.SPOUSE,
  [FAMILY_RELATION.PARENT]: FAMILY_RELATION.CHILD,
  [FAMILY_RELATION.CHILD]: FAMILY_RELATION.PARENT,
  [FAMILY_RELATION.SIBLING]: FAMILY_RELATION.SIBLING,
  [FAMILY_RELATION.GUARDIAN]: FAMILY_RELATION.DEPENDENT,
  [FAMILY_RELATION.DEPENDENT]: FAMILY_RELATION.GUARDIAN,
  [FAMILY_RELATION.GRANDPARENT]: FAMILY_RELATION.GRANDCHILD,
  [FAMILY_RELATION.GRANDCHILD]: FAMILY_RELATION.GRANDPARENT,
  [FAMILY_RELATION.IN_LAW]: FAMILY_RELATION.IN_LAW,
};

const RELATION_LABEL: Record<FamilyRelationType, string> = {
  [FAMILY_RELATION.SPOUSE]: "spouse",
  [FAMILY_RELATION.PARENT]: "parent",
  [FAMILY_RELATION.CHILD]: "child",
  [FAMILY_RELATION.SIBLING]: "sibling",
  [FAMILY_RELATION.GUARDIAN]: "guardian",
  [FAMILY_RELATION.DEPENDENT]: "dependent",
  [FAMILY_RELATION.GRANDPARENT]: "grandparent",
  [FAMILY_RELATION.GRANDCHILD]: "grandchild",
  [FAMILY_RELATION.IN_LAW]: "in-law",
};

const SUPPORTED_RELATIONS_MESSAGE =
  "Unsupported family relation. Allowed values: spouse, parent, child, sibling, guardian, dependent, grandparent, grandchild, in-law.";

type ParentChildRelation =
  | typeof FAMILY_RELATION.PARENT
  | typeof FAMILY_RELATION.CHILD;

type UpsertFamilyRelationOptions = {
  skipHierarchyPropagation?: boolean;
};

const isParentChildRelation = (
  relation: FamilyRelationType | string | null | undefined,
): relation is ParentChildRelation => {
  return (
    relation === FAMILY_RELATION.PARENT ||
    relation === FAMILY_RELATION.CHILD
  );
};

const deriveParentIdFromForwardRelation = (
  userId: number,
  familyId: number,
  relation: FamilyRelationType | string | null | undefined,
): number | null => {
  if (relation === FAMILY_RELATION.PARENT) {
    return familyId;
  }

  if (relation === FAMILY_RELATION.CHILD) {
    return userId;
  }

  return null;
};

const upsertBidirectionalFamilyRelationRaw = async (
  userId: number,
  familyId: number,
  relation: FamilyRelationType,
) => {
  const reciprocal = getReciprocalFamilyRelation(relation);

  await prisma.$transaction([
    prisma.family_relation.upsert({
      where: {
        user_id_family_id: {
          user_id: userId,
          family_id: familyId,
        },
      },
      update: {
        relation,
      },
      create: {
        user_id: userId,
        family_id: familyId,
        relation,
      },
    }),
    prisma.family_relation.upsert({
      where: {
        user_id_family_id: {
          user_id: familyId,
          family_id: userId,
        },
      },
      update: {
        relation: reciprocal,
      },
      create: {
        user_id: familyId,
        family_id: userId,
        relation: reciprocal,
      },
    }),
  ]);
};

const removeBidirectionalFamilyRelationRaw = async (
  userId: number,
  familyId: number,
) => {
  await prisma.family_relation.deleteMany({
    where: {
      OR: [
        {
          user_id: userId,
          family_id: familyId,
        },
        {
          user_id: familyId,
          family_id: userId,
        },
      ],
    },
  });
};

const getDirectChildIds = async (parentId: number): Promise<Set<number>> => {
  const [forwardChildren, reverseChildren, biologicalChildren] = await Promise.all([
    prisma.family_relation.findMany({
      where: {
        user_id: parentId,
        relation: FAMILY_RELATION.CHILD,
      },
      select: {
        family_id: true,
      },
    }),
    prisma.family_relation.findMany({
      where: {
        family_id: parentId,
        relation: FAMILY_RELATION.PARENT,
      },
      select: {
        user_id: true,
      },
    }),
    prisma.user.findMany({
      where: {
        parent_id: parentId,
      },
      select: {
        id: true,
      },
    }),
  ]);

  const childIds = new Set<number>();

  forwardChildren.forEach((entry) => childIds.add(entry.family_id));
  reverseChildren.forEach((entry) => childIds.add(entry.user_id));
  biologicalChildren.forEach((entry) => childIds.add(entry.id));

  return childIds;
};

const syncGrandparentRelationsForParent = async (parentId: number) => {
  const directChildren = await getDirectChildIds(parentId);
  const expectedGrandchildren = new Set<number>();

  for (const childId of directChildren) {
    const childChildren = await getDirectChildIds(childId);
    childChildren.forEach((grandchildId) => {
      if (grandchildId !== parentId && !directChildren.has(grandchildId)) {
        expectedGrandchildren.add(grandchildId);
      }
    });
  }

  const existingGrandchildren = await prisma.family_relation.findMany({
    where: {
      user_id: parentId,
      relation: FAMILY_RELATION.GRANDPARENT,
    },
    select: {
      family_id: true,
    },
  });

  const existingGrandchildIds = new Set<number>(
    existingGrandchildren.map((entry) => entry.family_id),
  );

  for (const grandchildId of expectedGrandchildren) {
    if (!existingGrandchildIds.has(grandchildId)) {
      await upsertBidirectionalFamilyRelationRaw(
        parentId,
        grandchildId,
        FAMILY_RELATION.GRANDPARENT,
      );
    }
  }

  for (const grandchildId of existingGrandchildIds) {
    if (!expectedGrandchildren.has(grandchildId)) {
      await removeBidirectionalFamilyRelationRaw(parentId, grandchildId);
    }
  }
};

export const normalizeFamilyRelation = (relation: unknown): FamilyRelationType => {
  if (typeof relation !== "string") {
    throw new Error(SUPPORTED_RELATIONS_MESSAGE);
  }

  const normalized = relation.trim().toLowerCase();
  const mapped = INPUT_TO_RELATION[normalized];

  if (!mapped) {
    throw new Error(SUPPORTED_RELATIONS_MESSAGE);
  }

  return mapped;
};

export const getReciprocalFamilyRelation = (
  relation: FamilyRelationType,
): FamilyRelationType => {
  return RECIPROCAL_RELATION[relation];
};

export const toFamilyRelationLabel = (relation: FamilyRelationType): string => {
  return RELATION_LABEL[relation];
};

export const upsertBidirectionalFamilyRelation = async (
  userId: number,
  familyId: number,
  relation: FamilyRelationType,
  options: UpsertFamilyRelationOptions = {},
) => {
  if (userId === familyId) {
    throw new Error("A member cannot create a relationship with themselves.");
  }

  const existingRelation = await prisma.family_relation.findUnique({
    where: {
      user_id_family_id: {
        user_id: userId,
        family_id: familyId,
      },
    },
    select: {
      relation: true,
    },
  });

  const parentIdsToSync = new Set<number>();
  const previousParentId = deriveParentIdFromForwardRelation(
    userId,
    familyId,
    existingRelation?.relation,
  );
  if (previousParentId) {
    parentIdsToSync.add(previousParentId);
  }

  const currentParentId = deriveParentIdFromForwardRelation(
    userId,
    familyId,
    relation,
  );
  if (currentParentId) {
    parentIdsToSync.add(currentParentId);
  }

  await upsertBidirectionalFamilyRelationRaw(userId, familyId, relation);

  if (options.skipHierarchyPropagation) {
    return;
  }

  for (const parentId of parentIdsToSync) {
    await syncGrandparentRelationsForParent(parentId);
  }
};

export const removeBidirectionalFamilyRelation = async (
  userId: number,
  familyId: number,
) => {
  const existingRelation = await prisma.family_relation.findUnique({
    where: {
      user_id_family_id: {
        user_id: userId,
        family_id: familyId,
      },
    },
    select: {
      relation: true,
    },
  });

  const parentIdToSync = deriveParentIdFromForwardRelation(
    userId,
    familyId,
    existingRelation?.relation,
  );

  await removeBidirectionalFamilyRelationRaw(userId, familyId);

  if (parentIdToSync) {
    await syncGrandparentRelationsForParent(parentIdToSync);
  }
};

export const pruneMissingBidirectionalFamilyRelations = async (
  userId: number,
  keepFamilyIds: Set<number>,
) => {
  const existingRelations = await prisma.family_relation.findMany({
    where: {
      user_id: userId,
    },
    select: {
      family_id: true,
      relation: true,
    },
  });

  const prunableRelations = existingRelations.filter(
    (relation) =>
      relation.relation !== FAMILY_RELATION.GRANDPARENT &&
      relation.relation !== FAMILY_RELATION.GRANDCHILD,
  );

  const staleRelations = prunableRelations.filter(
    (relation) => !keepFamilyIds.has(relation.family_id),
  );

  if (!staleRelations.length) {
    return;
  }

  const parentIdsToSync = new Set<number>();
  staleRelations.forEach((relation) => {
    if (!isParentChildRelation(relation.relation)) {
      return;
    }

    const parentId = deriveParentIdFromForwardRelation(
      userId,
      relation.family_id,
      relation.relation,
    );

    if (parentId) {
      parentIdsToSync.add(parentId);
    }
  });

  const staleRelationPairs = staleRelations.flatMap((relation) => [
    {
      user_id: userId,
      family_id: relation.family_id,
    },
    {
      user_id: relation.family_id,
      family_id: userId,
    },
  ]);

  await prisma.family_relation.deleteMany({
    where: {
      OR: staleRelationPairs,
    },
  });

  for (const parentId of parentIdsToSync) {
    await syncGrandparentRelationsForParent(parentId);
  }
};
