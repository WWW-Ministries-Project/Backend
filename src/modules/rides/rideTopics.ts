import { prisma } from "../../Models/context";
import type { RealtimeUser } from "../realtime/realtimeAuth";
import { topics } from "../realtime/realtimeTopics";
import { upcomingEvents } from "./rideService";

type RideTopicDeps = {
  isActiveMember: (userId: number) => Promise<boolean>;
  upcomingEventIds: () => Promise<number[]>;
};

/**
 * Who may follow `ride-event:<eventId>`: an active, non-guest member (the same
 * rule every ride endpoint applies) and only for an upcoming ride event.
 */
export const createRideEventAuthorizer =
  (deps: RideTopicDeps) =>
  async (user: RealtimeUser, id: string): Promise<boolean> => {
    if (user.isGuest) return false;
    const eventId = Number(id);
    if (!Number.isInteger(eventId) || eventId <= 0) return false;
    if (!(await deps.isActiveMember(user.userId))) return false;
    return (await deps.upcomingEventIds()).includes(eventId);
  };

const defaultDeps: RideTopicDeps = {
  isActiveMember: async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { is_active: true, is_guest: true },
    });
    return Boolean(user) && user?.is_active !== false && !user?.is_guest;
  },
  upcomingEventIds: async () => (await upcomingEvents()).map((event) => event.id),
};

/** Registers the rides topic family with the realtime server. Call once at boot. */
export const registerRideTopics = () => {
  topics.register("ride-event", createRideEventAuthorizer(defaultDeps));
};
