export type NotificationPreferenceChannelAvailability = {
  inApp: boolean;
  email: boolean;
  sms: boolean;
};

export type NotificationPreferenceOption = {
  type: string;
  title: string;
  description: string;
  category: string;
  availableChannels: NotificationPreferenceChannelAvailability;
};

const ALL_CHANNELS: NotificationPreferenceChannelAvailability = {
  inApp: true,
  email: true,
  sms: true,
};

const IN_APP_AND_EMAIL_CHANNELS: NotificationPreferenceChannelAvailability = {
  inApp: true,
  email: true,
  sms: false,
};

const DEFAULT_DESCRIPTION = "Manage how you receive this notification.";
const DEFAULT_CATEGORY = "Other";

export const NOTIFICATION_PREFERENCE_OPTIONS: NotificationPreferenceOption[] = [
  {
    type: "appointment.booked",
    title: "Appointment booked",
    description: "Alert staff when a member books an appointment with them.",
    category: "Appointments",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "appointment.status_changed",
    title: "Appointment status changed",
    description: "Notify participants when an appointment is confirmed or updated.",
    category: "Appointments",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "delivery.status_changed",
    title: "Delivery status changed",
    description: "Notify order owners when shipping or delivery status changes.",
    category: "Marketplace",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "event.cancelled",
    title: "Event cancelled",
    description: "Notify registered attendees when an event is cancelled.",
    category: "Events",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "event.registration_success",
    title: "Event registration success",
    description: "Confirm successful event registration to the attendee.",
    category: "Events",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "event.updated",
    title: "Event updated",
    description: "Notify registered attendees when event details change.",
    category: "Events",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "event_report.final_approved",
    title: "Event report approved",
    description: "Notify stakeholders when an event report is finally approved.",
    category: "Event reports",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "event_report.final_rejected",
    title: "Event report rejected",
    description: "Notify stakeholders when an event report is finally rejected.",
    category: "Event reports",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "event_report.submitted_for_final_approval",
    title: "Event report awaiting final approval",
    description: "Alert final approvers when an event report is ready for review.",
    category: "Event reports",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "follow_up.assigned",
    title: "Follow-up assigned",
    description: "Notify the assigned member about a new visitor follow-up.",
    category: "Visitors",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "follow_up.due",
    title: "Follow-up due",
    description: "Alert the assignee when a visitor follow-up is due today.",
    category: "Visitors",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "follow_up.overdue",
    title: "Follow-up overdue",
    description: "Alert the assignee when a visitor follow-up needs urgent attention.",
    category: "Visitors",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "order.payment_failed",
    title: "Order payment failed",
    description: "Notify buyers when a marketplace payment attempt fails.",
    category: "Marketplace",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "order.payment_success",
    title: "Order payment successful",
    description: "Notify buyers when a marketplace payment succeeds.",
    category: "Marketplace",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "requisition.comment_added",
    title: "Requisition comment added",
    description: "Notify participants when a new approval comment is posted.",
    category: "Requisitions",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "requisition.final_approved",
    title: "Requisition approved",
    description: "Notify stakeholders when a requisition is finally approved.",
    category: "Requisitions",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "requisition.final_rejected",
    title: "Requisition rejected",
    description: "Notify stakeholders when a requisition is finally rejected.",
    category: "Requisitions",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "requisition.step_advanced",
    title: "Requisition moved to next approver",
    description: "Notify the next approver when a requisition reaches their queue.",
    category: "Requisitions",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "requisition.submitted",
    title: "Requisition submitted",
    description: "Alert the first approver when a new requisition is submitted.",
    category: "Requisitions",
    availableChannels: ALL_CHANNELS,
  },
  {
    type: "system.job_failed",
    title: "System job failed",
    description: "Notify admins when a critical background job fails.",
    category: "System",
    availableChannels: IN_APP_AND_EMAIL_CHANNELS,
  },
];

const notificationPreferenceOptionByType = new Map(
  NOTIFICATION_PREFERENCE_OPTIONS.map((option) => [option.type, option]),
);

const humanizeNotificationType = (type: string): string =>
  type
    .split(".")
    .flatMap((segment) => segment.split("_"))
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const getNotificationPreferenceOption = (
  notificationType: string,
): NotificationPreferenceOption => {
  const normalizedType = String(notificationType || "").trim();
  const knownOption = notificationPreferenceOptionByType.get(normalizedType);
  if (knownOption) {
    return knownOption;
  }

  return {
    type: normalizedType,
    title: humanizeNotificationType(normalizedType) || "Notification",
    description: DEFAULT_DESCRIPTION,
    category: DEFAULT_CATEGORY,
    availableChannels: ALL_CHANNELS,
  };
};

export const listNotificationPreferenceTypes = (
  additionalTypes: string[] = [],
): string[] => {
  const knownTypes = NOTIFICATION_PREFERENCE_OPTIONS.map((option) => option.type);
  const knownTypeSet = new Set(knownTypes);
  const normalizedAdditionalTypes = Array.from(
    new Set(
      additionalTypes
        .map((type) => String(type || "").trim())
        .filter((type) => Boolean(type)),
    ),
  );

  const unknownTypes = normalizedAdditionalTypes
    .filter((type) => !knownTypeSet.has(type))
    .sort((left, right) => left.localeCompare(right));

  return [...knownTypes, ...unknownTypes];
};
