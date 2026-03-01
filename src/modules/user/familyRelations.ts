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
) => {
  if (userId === familyId) {
    throw new Error("A member cannot create a relationship with themselves.");
  }

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

export const removeBidirectionalFamilyRelation = async (
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
    },
  });

  const staleFamilyIds = existingRelations
    .map((relation) => relation.family_id)
    .filter((familyId) => !keepFamilyIds.has(familyId));

  if (!staleFamilyIds.length) {
    return;
  }

  const staleRelationPairs = staleFamilyIds.flatMap((familyId) => [
    {
      user_id: userId,
      family_id: familyId,
    },
    {
      user_id: familyId,
      family_id: userId,
    },
  ]);

  await prisma.family_relation.deleteMany({
    where: {
      OR: staleRelationPairs,
    },
  });
};
