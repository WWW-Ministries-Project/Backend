import { toTopic, toUser } from "../realtime/realtimeEmit";

/**
 * Realtime signals for rides. `rides.changed` tells the driver and passengers a
 * ride they are part of changed (My ride refetches); `rides.catalog_changed`
 * tells everyone browsing the event that seats or offers changed. Ids only —
 * visibility is per viewer, so clients refetch through REST.
 */

export const rideEventTopic = (eventId: number) => `ride-event:${eventId}`;

type RideChange = { eventId: number | null; offerId: number };

export const createRideChangeEmitter =
  (emit: { toUser: typeof toUser; toTopic: typeof toTopic } = { toUser, toTopic }) =>
  (change: RideChange, partyIds: number[], options: { catalog: boolean }) => {
    const parties = Array.from(new Set(partyIds.filter((id) => Number.isInteger(id) && id > 0)));
    if (parties.length) {
      emit.toUser(parties, "rides.changed", { eventId: change.eventId, offerId: change.offerId });
    }
    if (options.catalog && change.eventId) {
      emit.toTopic(rideEventTopic(change.eventId), "rides.catalog_changed", { eventId: change.eventId });
    }
  };

/** Call after the write commits. Never throws (realtimeEmit swallows failures). */
export const emitRideChange = createRideChangeEmitter();
