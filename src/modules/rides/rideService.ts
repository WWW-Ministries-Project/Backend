import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  AppError,
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { userHasMinimumDomainAccess } from "../../utils/permissionResolver";
import { notificationService } from "../notifications/notificationService";
import {
  cleanText,
  currentServiceDate,
  DECLINE_REASONS,
  DEPART_TIMES,
  displayClock,
  firstNameOf,
  initialsOf,
  isClockTime,
  isoDate,
  MAX_SEATS,
  MIN_SEATS,
  planStops,
  REMINDER_LEAD_MINUTES,
  addMinutes,
  REPORT_REASONS,
  SERVICE_LABEL,
  toPositiveInt,
} from "./rideHelpers";

/** Who handles safety reports and curates areas/pickup points. */
export const RIDE_SAFETY_DOMAIN = "Membership_Management";
const MEMBER_ACTION_URL = "/member/rides";

class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

/* ------------------------------------------------------------------ */
/* Shared lookups                                                      */
/* ------------------------------------------------------------------ */

const MEMBER_ONLY_MESSAGE = "Ride to church is for church members only.";

/** Only approved church members — not guests, not deactivated accounts — share rides. */
const assertMember = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, is_active: true, is_guest: true },
  });
  if (!user || user.is_active === false || user.is_guest) {
    throw new UnauthorizedError(MEMBER_ONLY_MESSAGE);
  }
  return user;
};

/** Everyone this member has blocked or been blocked by — neither side sees the other's rides. */
const blockedPeerIds = async (userId: number): Promise<Set<number>> => {
  const rows = await prisma.ride_block.findMany({
    where: { OR: [{ blocker_id: userId }, { blocked_id: userId }] },
    select: { blocker_id: true, blocked_id: true },
  });
  return new Set(rows.map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id)));
};

const isBlockedBetween = async (a: number, b: number) =>
  Boolean(
    await prisma.ride_block.findFirst({
      where: {
        OR: [
          { blocker_id: a, blocked_id: b },
          { blocker_id: b, blocked_id: a },
        ],
      },
      select: { id: true },
    }),
  );

const phoneSelect = { user_info: { select: { primary_number: true, country_code: true } } } as const;

const phoneOf = (user: { user_info?: { primary_number: string | null; country_code: string | null } | null }) => {
  const number = user.user_info?.primary_number?.trim();
  if (!number) return null;
  const code = user.user_info?.country_code?.trim();
  return code && !number.startsWith("+") && !number.startsWith("0") ? `${code}${number}` : number;
};

const offerInclude = {
  area: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true, ...phoneSelect } },
  stops: {
    orderBy: { position: "asc" },
    select: {
      pickup_point_id: true,
      position: true,
      pickup_time: true,
      pickup_point: { select: { id: true, name: true, area_label: true } },
    },
  },
  requests: {
    orderBy: { requested_at: "asc" },
    select: {
      id: true,
      status: true,
      passenger_id: true,
      pickup_time: true,
      decline_reason: true,
      decline_message: true,
      requested_at: true,
      pickup_point: { select: { id: true, name: true, area_label: true } },
      passenger: { select: { id: true, name: true, ...phoneSelect } },
    },
  },
} satisfies Prisma.ride_offerInclude;

type OfferWithDetail = Prisma.ride_offerGetPayload<{ include: typeof offerInclude }>;

const acceptedCount = (offer: { requests: { status: string }[] }) =>
  offer.requests.filter((request) => request.status === "ACCEPTED").length;

const seatsLeftOf = (offer: OfferWithDetail) => Math.max(0, offer.seats_total - acceptedCount(offer));

const pointView = (point: { id: number; name: string; area_label: string }) => ({
  id: point.id,
  name: point.name,
  area_label: point.area_label,
});

const routeNames = (offer: OfferWithDetail) => [
  offer.area.name,
  ...offer.stops.map((stop) => stop.pickup_point.name),
  "Church",
];

const notify = (input: Parameters<typeof notificationService.createInAppNotification>[0]) =>
  notificationService.createInAppNotification({ actionUrl: MEMBER_ACTION_URL, entityType: "ride", ...input }).catch(() => null);

/* ------------------------------------------------------------------ */
/* The member's current ride                                           */
/* ------------------------------------------------------------------ */

const ACTIVE_REQUEST_STATUSES = ["PENDING", "ACCEPTED"] as const;

const findActiveOffer = (userId: number, serviceDate: Date) =>
  prisma.ride_offer.findFirst({
    where: { driver_id: userId, service_date: serviceDate, status: "ACTIVE" },
    include: offerInclude,
  });

/**
 * The passenger's request that still needs their attention this Sunday: one
 * that is pending or accepted, or one that was declined / cancelled by the
 * driver and not yet acknowledged ("Find another ride").
 */
const findCurrentRequest = (userId: number, serviceDate: Date) =>
  prisma.ride_request.findFirst({
    where: {
      passenger_id: userId,
      offer: { service_date: serviceDate },
      OR: [
        { status: { in: [...ACTIVE_REQUEST_STATUSES] } },
        { status: "DECLINED", dismissed_at: null },
        { status: "CANCELLED", cancelled_by_driver: true, dismissed_at: null },
      ],
    },
    orderBy: { requested_at: "desc" },
    include: { offer: { include: offerInclude }, pickup_point: { select: { id: true, name: true, area_label: true } } },
  });

/** Driving, or holding a live seat request, for this service. */
const assertNotBusy = async (userId: number, serviceDate: Date) => {
  const [offer, request] = await Promise.all([
    prisma.ride_offer.findFirst({
      where: { driver_id: userId, service_date: serviceDate, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.ride_request.findFirst({
      where: {
        passenger_id: userId,
        status: { in: [...ACTIVE_REQUEST_STATUSES] },
        offer: { service_date: serviceDate, status: "ACTIVE" },
      },
      select: { id: true },
    }),
  ]);
  if (offer) throw new ConflictError("You are already driving this Sunday. Cancel that ride first.");
  if (request) throw new ConflictError("You already have a ride this Sunday.");
};

/** Clears any declined/cancelled request the passenger never acknowledged. */
const dismissStaleRequests = (userId: number, serviceDate: Date) =>
  prisma.ride_request.updateMany({
    where: {
      passenger_id: userId,
      dismissed_at: null,
      status: { in: ["DECLINED", "CANCELLED", "WITHDRAWN"] },
      offer: { service_date: serviceDate },
    },
    data: { dismissed_at: new Date() },
  });

const driverView = (offer: OfferWithDetail) => {
  const pending = offer.requests.filter((request) => request.status === "PENDING");
  const accepted = offer.requests.filter((request) => request.status === "ACCEPTED");
  const declined = offer.requests.filter((request) => request.status === "DECLINED");
  return {
    id: offer.id,
    service_date: isoDate(offer.service_date),
    area: offer.area,
    depart_time: offer.depart_time,
    reminder_time: addMinutes(offer.depart_time, -REMINDER_LEAD_MINUTES),
    seats_total: offer.seats_total,
    seats_left: seatsLeftOf(offer),
    car_details: offer.car_details,
    stops: offer.stops.map((stop) => ({ ...pointView(stop.pickup_point), pickup_time: stop.pickup_time })),
    route: routeNames(offer),
    pending_requests: pending.map((request) => ({
      id: request.id,
      passenger: {
        id: request.passenger.id,
        first_name: firstNameOf(request.passenger.name),
        initials: initialsOf(request.passenger.name),
      },
      pickup_point: pointView(request.pickup_point),
      pickup_time: request.pickup_time,
      requested_at: request.requested_at,
    })),
    // Accepted: the driver agreed to share, so the passenger's number unlocks.
    passengers: accepted.map((request) => ({
      request_id: request.id,
      id: request.passenger.id,
      name: request.passenger.name,
      first_name: firstNameOf(request.passenger.name),
      initials: initialsOf(request.passenger.name),
      phone: phoneOf(request.passenger),
      pickup_point: pointView(request.pickup_point),
      pickup_time: request.pickup_time,
    })),
    declined: declined.map((request) => ({
      request_id: request.id,
      id: request.passenger.id,
      first_name: firstNameOf(request.passenger.name),
      reason: request.decline_reason,
      message: request.decline_message,
    })),
  };
};

type CurrentRequest = NonNullable<Awaited<ReturnType<typeof findCurrentRequest>>>;

const passengerView = (request: CurrentRequest, userId: number) => {
  const offer = request.offer;
  const accepted = request.status === "ACCEPTED";
  const otherPassengers = offer.requests.filter(
    (row) => row.status === "ACCEPTED" && row.passenger_id !== userId,
  ).length;
  return {
    id: request.id,
    // A ride the driver cancelled reads to the passenger the same as a decline.
    status: request.status === "CANCELLED" ? "DECLINED" : request.status,
    cancelled_by_driver: request.cancelled_by_driver,
    pickup_point: pointView(request.pickup_point),
    pickup_time: request.pickup_time,
    decline_reason: request.cancelled_by_driver
      ? "The driver cancelled this ride"
      : request.decline_reason,
    decline_message: request.decline_message,
    reminder_time: addMinutes(offer.depart_time, -REMINDER_LEAD_MINUTES),
    ride: {
      id: offer.id,
      service_date: isoDate(offer.service_date),
      area: offer.area,
      depart_time: offer.depart_time,
      seats_total: offer.seats_total,
      seats_left: seatsLeftOf(offer),
      other_passengers: otherPassengers,
      route: routeNames(offer),
      driver: {
        id: offer.driver.id,
        name: offer.driver.name,
        first_name: firstNameOf(offer.driver.name),
        initials: initialsOf(offer.driver.name),
        // Contact and car details unlock only once the driver accepts.
        phone: accepted ? phoneOf(offer.driver) : null,
        car_details: accepted ? offer.car_details : null,
      },
    },
  };
};

export const getMyRide = async (userId: number) => {
  await assertMember(userId);
  const serviceDate = currentServiceDate();
  const offer = await findActiveOffer(userId, serviceDate);
  if (offer) {
    return { service_date: isoDate(serviceDate), service_label: SERVICE_LABEL, role: "driver", offer: driverView(offer), request: null };
  }
  const request = await findCurrentRequest(userId, serviceDate);
  if (request) {
    return {
      service_date: isoDate(serviceDate),
      service_label: SERVICE_LABEL,
      role: "passenger",
      offer: null,
      request: passengerView(request, userId),
    };
  }
  return { service_date: isoDate(serviceDate), service_label: SERVICE_LABEL, role: null, offer: null, request: null };
};

/* ------------------------------------------------------------------ */
/* Catalog + search                                                    */
/* ------------------------------------------------------------------ */

/** Active offers for the service other than the viewer's own, minus blocked drivers. */
const visibleOffers = async (userId: number, serviceDate: Date, pickupPointId?: number) => {
  const blocked = await blockedPeerIds(userId);
  const offers = await prisma.ride_offer.findMany({
    where: {
      service_date: serviceDate,
      status: "ACTIVE",
      driver_id: { not: userId },
      ...(pickupPointId ? { stops: { some: { pickup_point_id: pickupPointId } } } : {}),
    },
    include: offerInclude,
    orderBy: { depart_time: "asc" },
  });
  return offers.filter((offer) => !blocked.has(offer.driver_id));
};

export const getCatalog = async (userId: number) => {
  await assertMember(userId);
  const serviceDate = currentServiceDate();
  const [areas, points, offers, lastOffer, lastRequest, lastAlert, alerts] = await Promise.all([
    prisma.ride_area.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        route: {
          where: { pickup_point: { is_active: true } },
          orderBy: { position: "asc" },
          select: { pickup_point_id: true, minutes_from_start: true },
        },
      },
    }),
    prisma.ride_pickup_point.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, area_label: true },
    }),
    visibleOffers(userId, serviceDate),
    prisma.ride_offer.findFirst({
      where: { driver_id: userId },
      orderBy: { created_at: "desc" },
      select: { area_id: true, car_details: true, seats_total: true, depart_time: true },
    }),
    prisma.ride_request.findFirst({
      where: { passenger_id: userId },
      orderBy: { requested_at: "desc" },
      select: { pickup_point_id: true, requested_at: true },
    }),
    prisma.ride_pickup_alert.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
      select: { pickup_point_id: true, created_at: true },
    }),
    prisma.ride_pickup_alert.findMany({
      where: { user_id: userId, service_date: serviceDate },
      select: { pickup_point_id: true },
    }),
  ]);

  const openRidesAt = new Map<number, number>();
  for (const offer of offers) {
    if (seatsLeftOf(offer) <= 0) continue;
    for (const stop of offer.stops) {
      openRidesAt.set(stop.pickup_point_id, (openRidesAt.get(stop.pickup_point_id) ?? 0) + 1);
    }
  }

  const recent =
    lastRequest && (!lastAlert || lastRequest.requested_at >= lastAlert.created_at)
      ? lastRequest.pickup_point_id
      : lastAlert?.pickup_point_id ?? null;

  return {
    service_date: isoDate(serviceDate),
    service_label: SERVICE_LABEL,
    depart_times: DEPART_TIMES,
    min_seats: MIN_SEATS,
    max_seats: MAX_SEATS,
    decline_reasons: DECLINE_REASONS,
    report_reasons: REPORT_REASONS,
    areas: areas.map((area) => ({
      id: area.id,
      name: area.name,
      route: area.route.map((stop) => ({ pickup_point_id: stop.pickup_point_id, minutes: stop.minutes_from_start })),
    })),
    pickup_points: points.map((point) => ({ ...point, open_rides: openRidesAt.get(point.id) ?? 0 })),
    recent_pickup_point_id: recent && points.some((point) => point.id === recent) ? recent : null,
    alert_pickup_point_ids: alerts.map((alert) => alert.pickup_point_id),
    last_offer: lastOffer
      ? {
          area_id: lastOffer.area_id,
          car_details: lastOffer.car_details,
          seats_total: lastOffer.seats_total,
          depart_time: lastOffer.depart_time,
        }
      : null,
  };
};

export const searchRides = async (userId: number, pickupPointIdRaw: unknown) => {
  await assertMember(userId);
  const pickupPointId = toPositiveInt(pickupPointIdRaw);
  if (!pickupPointId) throw new InputValidationError("Choose a pickup point");
  const point = await prisma.ride_pickup_point.findFirst({
    where: { id: pickupPointId, is_active: true },
    select: { id: true, name: true, area_label: true },
  });
  if (!point) throw new NotFoundError("Pickup point not found");

  const serviceDate = currentServiceDate();
  const [offers, alert, myOffer, myRequests] = await Promise.all([
    visibleOffers(userId, serviceDate, pickupPointId),
    prisma.ride_pickup_alert.findUnique({
      where: { user_id_pickup_point_id_service_date: { user_id: userId, pickup_point_id: pickupPointId, service_date: serviceDate } },
      select: { id: true },
    }),
    prisma.ride_offer.findFirst({
      where: { driver_id: userId, service_date: serviceDate, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.ride_request.findMany({
      where: { passenger_id: userId, offer: { service_date: serviceDate } },
      orderBy: { requested_at: "desc" },
      select: { offer_id: true, status: true },
    }),
  ]);

  const myStatusByOffer = new Map<number, string>();
  for (const request of myRequests) {
    if (!myStatusByOffer.has(request.offer_id)) myStatusByOffer.set(request.offer_id, request.status);
  }
  const busy =
    Boolean(myOffer) ||
    myRequests.some((request) => (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status));

  const open = offers.filter((offer) => seatsLeftOf(offer) > 0);
  return {
    service_date: isoDate(serviceDate),
    pickup_point: point,
    alert_on: Boolean(alert),
    busy,
    full_count: offers.length - open.length,
    rides: open.map((offer) => {
      const stop = offer.stops.find((row) => row.pickup_point_id === pickupPointId)!;
      return {
        id: offer.id,
        driver: { id: offer.driver.id, first_name: firstNameOf(offer.driver.name), initials: initialsOf(offer.driver.name) },
        area: offer.area,
        depart_time: offer.depart_time,
        seats_left: seatsLeftOf(offer),
        pickup_time: stop.pickup_time,
        route: routeNames(offer),
        my_request_status: myStatusByOffer.get(offer.id) ?? null,
      };
    }),
  };
};

/* ------------------------------------------------------------------ */
/* Driver: publish / cancel                                            */
/* ------------------------------------------------------------------ */

export const publishOffer = async (userId: number, body: any) => {
  const driver = await assertMember(userId);
  const areaId = toPositiveInt(body?.area_id);
  const departTime = body?.depart_time;
  const seats = Number(body?.seats);
  const pickupPointIds: number[] = Array.from(
    new Set<number>(
      (Array.isArray(body?.pickup_point_ids) ? body.pickup_point_ids : [])
        .map(toPositiveInt)
        .filter((id: number | null): id is number => id !== null),
    ),
  );
  const carDetails = cleanText(body?.car_details, 160);

  if (!areaId) throw new InputValidationError("Choose the area you're starting from");
  if (!isClockTime(departTime)) throw new InputValidationError("Choose a departure time");
  if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
    throw new InputValidationError(`Seats must be between ${MIN_SEATS} and ${MAX_SEATS}`);
  }
  if (!pickupPointIds.length) {
    throw new InputValidationError("Add at least one pickup point so riders can find your ride");
  }

  const [area, points] = await Promise.all([
    prisma.ride_area.findFirst({
      where: { id: areaId, is_active: true },
      select: { id: true, route: { select: { pickup_point_id: true, position: true, minutes_from_start: true } } },
    }),
    prisma.ride_pickup_point.findMany({
      where: { id: { in: pickupPointIds }, is_active: true },
      select: { id: true },
    }),
  ]);
  if (!area) throw new NotFoundError("Area not found");
  if (points.length !== pickupPointIds.length) throw new InputValidationError("One of those pickup points is no longer available");

  const serviceDate = currentServiceDate();
  await assertNotBusy(userId, serviceDate);
  await dismissStaleRequests(userId, serviceDate);

  const route = new Map(area.route.map((stop) => [stop.pickup_point_id, { position: stop.position, minutes: stop.minutes_from_start }]));
  const stops = planStops(departTime, pickupPointIds, route);

  const offer = await prisma.ride_offer.create({
    data: {
      driver_id: userId,
      service_date: serviceDate,
      area_id: area.id,
      depart_time: departTime,
      seats_total: seats,
      car_details: carDetails,
      stops: { create: stops },
    },
    include: offerInclude,
  });

  // Riders who asked to hear about a ride passing one of these points.
  const blocked = await blockedPeerIds(userId);
  const alerts = await prisma.ride_pickup_alert.findMany({
    where: {
      service_date: serviceDate,
      notified_at: null,
      pickup_point_id: { in: pickupPointIds },
      user_id: { not: userId },
    },
    select: { id: true, user_id: true, pickup_point_id: true, pickup_point: { select: { name: true } } },
  });
  const toNotify = alerts.filter((alert) => !blocked.has(alert.user_id));
  if (toNotify.length) {
    await prisma.ride_pickup_alert.updateMany({
      where: { id: { in: toNotify.map((alert) => alert.id) } },
      data: { notified_at: new Date() },
    });
    for (const alert of toNotify) {
      void notify({
        type: "ride.available",
        title: "A ride now passes your pickup point",
        body: `${firstNameOf(driver.name)} is driving to church on Sunday and passes ${alert.pickup_point.name}. Request a seat before it fills.`,
        recipientUserId: alert.user_id,
        entityId: offer.id,
        // Straight to Find, already filtered to the point they asked about.
        actionUrl: `${MEMBER_ACTION_URL}/find?pickup_point_id=${alert.pickup_point_id}`,
        dedupeKey: `ride.available:${offer.id}:${alert.user_id}`,
        sendEmail: false,
      });
    }
  }

  return driverView(offer);
};

const loadOwnedOffer = async (userId: number, offerIdRaw: unknown) => {
  const offerId = toPositiveInt(offerIdRaw);
  if (!offerId) throw new InputValidationError("Ride id is required");
  const offer = await prisma.ride_offer.findUnique({ where: { id: offerId }, include: offerInclude });
  if (!offer) throw new NotFoundError("Ride not found");
  if (offer.driver_id !== userId) throw new UnauthorizedError("This isn't your ride");
  return offer;
};

export const cancelOffer = async (userId: number, offerIdRaw: unknown) => {
  const offer = await loadOwnedOffer(userId, offerIdRaw);
  if (offer.status !== "ACTIVE") throw new ConflictError("This ride is already cancelled");

  const affected = offer.requests.filter((request) => (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status));
  const now = new Date();
  await prisma.$transaction([
    prisma.ride_offer.update({ where: { id: offer.id }, data: { status: "CANCELLED", cancelled_at: now } }),
    prisma.ride_request.updateMany({
      where: { offer_id: offer.id, status: { in: [...ACTIVE_REQUEST_STATUSES] } },
      data: { status: "CANCELLED", cancelled_by_driver: true, cancelled_at: now },
    }),
  ]);

  const driverFirst = firstNameOf(offer.driver.name);
  for (const request of affected) {
    void notify({
      type: "ride.cancelled",
      title: `${driverFirst} cancelled Sunday's ride`,
      body: "Your seat has been released. Find another ride from your pickup point in the app.",
      recipientUserId: request.passenger_id,
      actorUserId: userId,
      entityId: request.id,
      priority: "HIGH",
      dedupeKey: `ride.cancelled:${request.id}`,
    });
  }
  return { id: offer.id, status: "CANCELLED" };
};

/* ------------------------------------------------------------------ */
/* Passenger: request / withdraw / acknowledge                         */
/* ------------------------------------------------------------------ */

export const requestSeat = async (userId: number, body: any) => {
  const passenger = await assertMember(userId);
  const offerId = toPositiveInt(body?.ride_offer_id);
  const pickupPointId = toPositiveInt(body?.pickup_point_id);
  if (!offerId) throw new InputValidationError("Choose a ride");
  if (!pickupPointId) throw new InputValidationError("Choose a pickup point");

  const offer = await prisma.ride_offer.findUnique({ where: { id: offerId }, include: offerInclude });
  const serviceDate = currentServiceDate();
  if (!offer || offer.status !== "ACTIVE" || isoDate(offer.service_date) !== isoDate(serviceDate)) {
    throw new NotFoundError("This ride is no longer available");
  }
  if (offer.driver_id === userId) throw new InputValidationError("You can't request a seat on your own ride");
  if (await isBlockedBetween(userId, offer.driver_id)) throw new NotFoundError("This ride is no longer available");
  const stop = offer.stops.find((row) => row.pickup_point_id === pickupPointId);
  if (!stop) throw new InputValidationError("This ride doesn't pass that pickup point");
  if (seatsLeftOf(offer) <= 0) throw new ConflictError("This ride is now full");

  await assertNotBusy(userId, serviceDate);
  await dismissStaleRequests(userId, serviceDate);

  const request = await prisma.ride_request.create({
    data: {
      offer_id: offer.id,
      passenger_id: userId,
      pickup_point_id: pickupPointId,
      pickup_time: stop.pickup_time,
    },
    select: { id: true },
  });

  void notify({
    type: "ride.request_received",
    title: `${firstNameOf(passenger.name)} wants to join your ride`,
    body: `Pickup at ${stop.pickup_point.name}, ${displayClock(stop.pickup_time)}. Accept or decline in the app.`,
    recipientUserId: offer.driver_id,
    actorUserId: userId,
    entityId: request.id,
    priority: "HIGH",
    dedupeKey: `ride.request_received:${request.id}`,
  });

  return getMyRide(userId);
};

const loadRequest = async (requestIdRaw: unknown) => {
  const requestId = toPositiveInt(requestIdRaw);
  if (!requestId) throw new InputValidationError("Request id is required");
  const request = await prisma.ride_request.findUnique({
    where: { id: requestId },
    include: {
      offer: { select: { id: true, driver_id: true, status: true, seats_total: true, driver: { select: { name: true } } } },
      passenger: { select: { id: true, name: true } },
      pickup_point: { select: { name: true } },
    },
  });
  if (!request) throw new NotFoundError("Request not found");
  return request;
};

export const cancelRequest = async (userId: number, requestIdRaw: unknown) => {
  const request = await loadRequest(requestIdRaw);
  if (request.passenger_id !== userId) throw new UnauthorizedError("This isn't your request");
  if (!(ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status)) {
    throw new ConflictError("This request is already closed");
  }
  const wasAccepted = request.status === "ACCEPTED";
  const now = new Date();
  await prisma.ride_request.update({
    where: { id: request.id },
    data: { status: wasAccepted ? "CANCELLED" : "WITHDRAWN", cancelled_at: now, dismissed_at: now },
  });

  const first = firstNameOf(request.passenger.name);
  void notify({
    type: "ride.request_withdrawn",
    title: wasAccepted ? `${first} can no longer make it` : `${first} withdrew their request`,
    body: wasAccepted
      ? `${first} cancelled their seat on Sunday's ride, so it's free again.`
      : `${first} no longer needs a seat on Sunday's ride.`,
    recipientUserId: request.offer.driver_id,
    actorUserId: userId,
    entityId: request.id,
    priority: wasAccepted ? "HIGH" : "MEDIUM",
    dedupeKey: `ride.request_withdrawn:${request.id}`,
  });
  return { id: request.id, status: wasAccepted ? "CANCELLED" : "WITHDRAWN" };
};

/** The passenger has read a decline / driver cancellation and moves on. */
export const dismissRequest = async (userId: number, requestIdRaw: unknown) => {
  const request = await loadRequest(requestIdRaw);
  if (request.passenger_id !== userId) throw new UnauthorizedError("This isn't your request");
  if ((ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status)) {
    throw new ConflictError("Withdraw the request instead");
  }
  await prisma.ride_request.update({ where: { id: request.id }, data: { dismissed_at: new Date() } });
  return { id: request.id };
};

/* ------------------------------------------------------------------ */
/* Driver: accept / decline                                            */
/* ------------------------------------------------------------------ */

export const acceptRequest = async (userId: number, requestIdRaw: unknown) => {
  const request = await loadRequest(requestIdRaw);
  if (request.offer.driver_id !== userId) throw new UnauthorizedError("This isn't your ride");
  if (request.offer.status !== "ACTIVE") throw new ConflictError("This ride was cancelled");
  if (request.status !== "PENDING") throw new ConflictError("This request is already decided");

  await prisma.$transaction(async (tx) => {
    // Lock the ride row first so two accepts on the same ride run one after
    // the other; without it both could count the same free seat and overfill
    // the car. The lock is taken before the transaction's first plain read,
    // so the count below sees whatever the previous accept committed.
    await tx.$queryRaw`SELECT id FROM ride_offer WHERE id = ${request.offer.id} FOR UPDATE`;
    const taken = await tx.ride_request.count({ where: { offer_id: request.offer.id, status: "ACCEPTED" } });
    if (taken >= request.offer.seats_total) throw new ConflictError("Your car is full. Decline this request instead.");
    const updated = await tx.ride_request.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "ACCEPTED", decided_at: new Date() },
    });
    if (!updated.count) throw new ConflictError("This request is already decided");
  });

  const driverFirst = firstNameOf(request.offer.driver.name);
  void notify({
    type: "ride.request_accepted",
    title: "Ride confirmed",
    body: `${driverFirst} accepted your request. Be at ${request.pickup_point.name} by ${displayClock(request.pickup_time)} on Sunday. Their phone and car details are now in the app.`,
    recipientUserId: request.passenger_id,
    actorUserId: userId,
    entityId: request.id,
    priority: "HIGH",
    dedupeKey: `ride.request_accepted:${request.id}`,
  });
  return getMyRide(userId);
};

export const declineRequest = async (userId: number, requestIdRaw: unknown, body: any) => {
  const request = await loadRequest(requestIdRaw);
  if (request.offer.driver_id !== userId) throw new UnauthorizedError("This isn't your ride");
  if (request.status !== "PENDING") throw new ConflictError("This request is already decided");
  const reason = cleanText(body?.reason, 160);
  const message = cleanText(body?.message, 500);
  if (!reason && !message) throw new InputValidationError("Choose a reason or add a message");

  await prisma.ride_request.update({
    where: { id: request.id },
    data: { status: "DECLINED", decided_at: new Date(), decline_reason: reason, decline_message: message },
  });

  const driverFirst = firstNameOf(request.offer.driver.name);
  void notify({
    type: "ride.request_declined",
    title: `${driverFirst} can't take you this time`,
    body: [reason, message].filter(Boolean).join(" · ") || "Your seat request was declined. Find another ride in the app.",
    recipientUserId: request.passenger_id,
    actorUserId: userId,
    entityId: request.id,
    dedupeKey: `ride.request_declined:${request.id}`,
  });
  return getMyRide(userId);
};

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export const setPickupAlert = async (userId: number, body: any) => {
  await assertMember(userId);
  const pickupPointId = toPositiveInt(body?.pickup_point_id);
  if (!pickupPointId) throw new InputValidationError("Choose a pickup point");
  const enabled = body?.enabled !== false && body?.enabled !== "false";
  const point = await prisma.ride_pickup_point.findFirst({ where: { id: pickupPointId, is_active: true }, select: { id: true } });
  if (!point) throw new NotFoundError("Pickup point not found");

  const serviceDate = currentServiceDate();
  const key = { user_id: userId, pickup_point_id: pickupPointId, service_date: serviceDate };
  if (enabled) {
    await prisma.ride_pickup_alert.upsert({
      where: { user_id_pickup_point_id_service_date: key },
      update: { notified_at: null },
      create: key,
    });
  } else {
    await prisma.ride_pickup_alert.deleteMany({ where: key });
  }
  return { pickup_point_id: pickupPointId, alert_on: enabled };
};

/* ------------------------------------------------------------------ */
/* Safety reports + blocks                                             */
/* ------------------------------------------------------------------ */

/** Everyone who can manage membership — the church safety team for rides. */
const safetyTeamIds = async (excludeIds: number[]): Promise<number[]> => {
  const candidates = await prisma.user.findMany({
    where: { is_active: true, access: { isNot: null }, id: { notIn: excludeIds } },
    select: { id: true, access: { select: { permissions: true } } },
  });
  return candidates
    .filter((candidate) => userHasMinimumDomainAccess(candidate.access?.permissions, RIDE_SAFETY_DOMAIN, "manage"))
    .map((candidate) => candidate.id);
};

export const fileReport = async (userId: number, body: any) => {
  const reporter = await assertMember(userId);
  const offerId = toPositiveInt(body?.ride_offer_id);
  const reason = cleanText(body?.reason, 120);
  const details = cleanText(body?.details, 2000);
  const block = body?.block === true || body?.block === "true";
  if (!offerId) throw new InputValidationError("Which ride is this about?");
  if (!reason) throw new InputValidationError("Choose what happened");

  const offer = await prisma.ride_offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      driver_id: true,
      driver: { select: { name: true } },
      requests: {
        where: { status: { in: ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED"] } },
        select: { id: true, passenger_id: true, status: true, passenger: { select: { name: true } } },
      },
    },
  });
  if (!offer) throw new NotFoundError("Ride not found");

  let reportedUserId: number | null = null;
  let requestId: number | null = null;
  if (offer.driver_id === userId) {
    // A driver reports one of the members who asked to join.
    const asked = toPositiveInt(body?.reported_user_id);
    const candidates = offer.requests;
    const target = asked
      ? candidates.find((row) => row.passenger_id === asked)
      : candidates.length === 1
        ? candidates[0]
        : null;
    if (asked && !target) throw new InputValidationError("That member isn't on this ride");
    reportedUserId = target?.passenger_id ?? null;
    requestId = target?.id ?? null;
  } else {
    const mine = offer.requests.find((row) => row.passenger_id === userId);
    if (!mine) throw new UnauthorizedError("You can only report a ride you were part of");
    reportedUserId = offer.driver_id;
    requestId = mine.id;
  }

  const report = await prisma.ride_report.create({
    data: {
      reporter_id: userId,
      reported_user_id: reportedUserId,
      offer_id: offer.id,
      request_id: requestId,
      reason,
      details,
      blocked: Boolean(block && reportedUserId),
    },
    select: { id: true },
  });

  if (block && reportedUserId) {
    await prisma.ride_block.upsert({
      where: { blocker_id_blocked_id: { blocker_id: userId, blocked_id: reportedUserId } },
      update: {},
      create: { blocker_id: userId, blocked_id: reportedUserId },
    });
  }

  const team = await safetyTeamIds([userId, ...(reportedUserId ? [reportedUserId] : [])]);
  if (team.length) {
    const reportedName = reportedUserId
      ? offer.driver_id === reportedUserId
        ? offer.driver.name
        : offer.requests.find((row) => row.passenger_id === reportedUserId)?.passenger.name ?? "a member"
      : "a member";
    await notificationService.createManyInAppNotifications(
      team.map((recipientUserId) => ({
        type: "ride.safety_report",
        title: "Ride safety concern reported",
        body: `${reporter.name} reported ${reportedName}: ${reason}.${block && reportedUserId ? " They also blocked this member from their rides." : ""} Please contact them within 24 hours.`,
        recipientUserId,
        actorUserId: userId,
        entityType: "ride_report",
        entityId: report.id,
        priority: "HIGH",
        dedupeKey: `ride.safety_report:${report.id}:${recipientUserId}`,
      })),
    );
  }

  return { id: report.id, blocked: Boolean(block && reportedUserId) };
};

/* ------------------------------------------------------------------ */
/* Safety team / church office                                         */
/* ------------------------------------------------------------------ */

const assertSafetyTeam = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { access: { select: { permissions: true } } },
  });
  if (!userHasMinimumDomainAccess(user?.access?.permissions, RIDE_SAFETY_DOMAIN, "manage")) {
    throw new UnauthorizedError("Not authorized to manage rides");
  }
};

export const listReports = async (userId: number, statusRaw: unknown) => {
  await assertSafetyTeam(userId);
  const status = String(statusRaw ?? "OPEN").toUpperCase();
  const reports = await prisma.ride_report.findMany({
    where: status === "ALL" ? {} : { status: status === "RESOLVED" ? "RESOLVED" : "OPEN" },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      reason: true,
      details: true,
      blocked: true,
      status: true,
      resolution_note: true,
      resolved_at: true,
      created_at: true,
      reporter: { select: { id: true, name: true, ...phoneSelect } },
      reported_user: { select: { id: true, name: true, ...phoneSelect } },
      resolver: { select: { id: true, name: true } },
      offer: { select: { id: true, service_date: true, depart_time: true, area: { select: { name: true } } } },
    },
  });
  return reports.map((report) => ({
    ...report,
    reporter: { id: report.reporter.id, name: report.reporter.name, phone: phoneOf(report.reporter) },
    reported_user: report.reported_user
      ? { id: report.reported_user.id, name: report.reported_user.name, phone: phoneOf(report.reported_user) }
      : null,
    offer: report.offer
      ? { id: report.offer.id, service_date: isoDate(report.offer.service_date), depart_time: report.offer.depart_time, area: report.offer.area.name }
      : null,
  }));
};

export const resolveReport = async (userId: number, reportIdRaw: unknown, body: any) => {
  await assertSafetyTeam(userId);
  const reportId = toPositiveInt(reportIdRaw);
  if (!reportId) throw new InputValidationError("Report id is required");
  const report = await prisma.ride_report.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!report) throw new NotFoundError("Report not found");
  await prisma.ride_report.update({
    where: { id: reportId },
    data: {
      status: "RESOLVED",
      resolved_by: userId,
      resolved_at: new Date(),
      resolution_note: cleanText(body?.resolution_note, 2000),
    },
  });
  return { id: reportId, status: "RESOLVED" };
};

export const getAdminCatalog = async (userId: number) => {
  await assertSafetyTeam(userId);
  const [areas, points] = await Promise.all([
    prisma.ride_area.findMany({
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sort_order: true,
        is_active: true,
        route: {
          orderBy: { position: "asc" },
          select: { pickup_point_id: true, position: true, minutes_from_start: true },
        },
      },
    }),
    prisma.ride_pickup_point.findMany({
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, area_label: true, sort_order: true, is_active: true },
    }),
  ]);
  return { areas, pickup_points: points };
};

export const savePickupPoint = async (userId: number, idRaw: unknown, body: any) => {
  await assertSafetyTeam(userId);
  const id = toPositiveInt(idRaw);
  const name = cleanText(body?.name, 120);
  const areaLabel = cleanText(body?.area_label, 120);
  const data = {
    ...(name ? { name } : {}),
    ...(areaLabel ? { area_label: areaLabel } : {}),
    ...(Number.isInteger(Number(body?.sort_order)) && body?.sort_order !== undefined ? { sort_order: Number(body.sort_order) } : {}),
    ...(typeof body?.is_active === "boolean" ? { is_active: body.is_active } : {}),
  };
  if (id) {
    return prisma.ride_pickup_point.update({ where: { id }, data });
  }
  if (!name || !areaLabel) throw new InputValidationError("Name and area are required");
  return prisma.ride_pickup_point.create({ data: { name, area_label: areaLabel, sort_order: data.sort_order ?? 0 } });
};

export const saveArea = async (userId: number, idRaw: unknown, body: any) => {
  await assertSafetyTeam(userId);
  const id = toPositiveInt(idRaw);
  const name = cleanText(body?.name, 120);
  const route: { pickup_point_id: number; minutes: number }[] | null = Array.isArray(body?.route)
    ? body.route
        .map((stop: any) => ({ pickup_point_id: toPositiveInt(stop?.pickup_point_id), minutes: Number(stop?.minutes) }))
        .filter((stop: any) => stop.pickup_point_id && Number.isFinite(stop.minutes) && stop.minutes >= 0)
    : null;
  const data = {
    ...(name ? { name } : {}),
    ...(Number.isInteger(Number(body?.sort_order)) && body?.sort_order !== undefined ? { sort_order: Number(body.sort_order) } : {}),
    ...(typeof body?.is_active === "boolean" ? { is_active: body.is_active } : {}),
  };
  if (!id && !name) throw new InputValidationError("Name is required");

  return prisma.$transaction(async (tx) => {
    const area = id
      ? await tx.ride_area.update({ where: { id }, data })
      : await tx.ride_area.create({ data: { name: name!, sort_order: data.sort_order ?? 0 } });
    if (route) {
      await tx.ride_area_route.deleteMany({ where: { area_id: area.id } });
      if (route.length) {
        await tx.ride_area_route.createMany({
          data: route.map((stop, index) => ({
            area_id: area.id,
            pickup_point_id: stop.pickup_point_id,
            position: index + 1,
            minutes_from_start: Math.round(stop.minutes),
          })),
          skipDuplicates: true,
        });
      }
    }
    return area;
  });
};

/* ------------------------------------------------------------------ */
/* Reminders (cron)                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reminds the driver and every accepted passenger shortly before the driver
 * sets off. Called by the ride reminder cron with today's church date and the
 * current church-clock minutes.
 */
export const sendDueReminders = async (today: Date, minutesNow: number) => {
  const offers = await prisma.ride_offer.findMany({
    where: { service_date: today, status: "ACTIVE", reminder_sent: false },
    include: offerInclude,
  });
  let sent = 0;
  for (const offer of offers) {
    const [hours, minutes] = offer.depart_time.split(":").map(Number);
    if (hours * 60 + minutes - REMINDER_LEAD_MINUTES > minutesNow) continue;

    const claimed = await prisma.ride_offer.updateMany({
      where: { id: offer.id, reminder_sent: false },
      data: { reminder_sent: true },
    });
    if (!claimed.count) continue;

    const passengers = offer.requests.filter((request) => request.status === "ACCEPTED");
    const driverFirst = firstNameOf(offer.driver.name);
    void notify({
      type: "ride.reminder",
      title: "You're driving to church soon",
      body: passengers.length
        ? `Leave ${offer.area.name} at ${displayClock(offer.depart_time)}. Picking up ${passengers
            .map((request) => `${firstNameOf(request.passenger.name)} at ${request.pickup_point.name} (${displayClock(request.pickup_time)})`)
            .join(", ")}.`
        : `Leave ${offer.area.name} at ${displayClock(offer.depart_time)}. No passengers this time.`,
      recipientUserId: offer.driver_id,
      entityId: offer.id,
      priority: "HIGH",
      dedupeKey: `ride.reminder:offer:${offer.id}`,
      sendEmail: false,
    });
    for (const request of passengers) {
      void notify({
        type: "ride.reminder",
        title: "Your ride to church is soon",
        body: `Be at ${request.pickup_point.name} by ${displayClock(request.pickup_time)}. ${driverFirst} is picking you up.`,
        recipientUserId: request.passenger_id,
        entityId: request.id,
        priority: "HIGH",
        dedupeKey: `ride.reminder:request:${request.id}`,
        sendEmail: false,
      });
    }
    sent += 1;
  }
  return sent;
};
