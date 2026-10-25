import { Request, Response } from "express";
import * as service from "./messagingService";
import { resolveMessagingAccess } from "./messagingAccess";

const actorId = (req: Request): number | null => {
  const id = Number((req as any)?.user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// The service validates ids (invalid -> 404), so NaN passes straight through.
const idParam = (req: Request): number => Number(req.params.id);

export const messagingController = {
  listTemplates: async (_req: Request, res: Response) =>
    res.json({ message: "Templates", data: await service.listTemplates() }),
  updateTemplate: async (req: Request, res: Response) =>
    res.json({ message: "Template saved", data: await service.updateTemplate(req.params.key, req.body, actorId(req), await resolveMessagingAccess(req)) }),
  /** The caller's Messaging actions and audience scope, for the web compose screen. */
  access: async (req: Request, res: Response) => {
    const { actions, departmentIds } = await resolveMessagingAccess(req);
    return res.json({ message: "Access", data: { actions, departmentIds } });
  },
  getSettings: async (_req: Request, res: Response) =>
    res.json({ message: "Settings", data: await service.getSettings() }),
  updateSettings: async (req: Request, res: Response) =>
    res.json({ message: "Settings saved", data: await service.updateSettings(req.body, actorId(req), await resolveMessagingAccess(req)) }),
  placeholders: async (req: Request, res: Response) =>
    res.json({ message: "Placeholders", data: service.listPlaceholders(req.query.kind) }),
  preview: async (req: Request, res: Response) =>
    res.json({ message: "Preview", data: await service.preview(req.body) }),
  audienceCount: async (req: Request, res: Response) =>
    res.json({ message: "Audience", data: await service.audienceCount(req.body, await resolveMessagingAccess(req)) }),
  upcomingBirthdays: async (req: Request, res: Response) =>
    res.json({ message: "Upcoming birthdays", data: await service.upcomingBirthdays(Number(req.query.days)) }),
  stats: async (req: Request, res: Response) =>
    res.json({ message: "Stats", data: await service.templateStats(Number(req.query.days)) }),
  overview: async (req: Request, res: Response) =>
    res.json({ message: "Overview", data: await service.overviewStats(Number(req.query.days)) }),
  createDispatch: async (req: Request, res: Response) =>
    res.status(201).json({ message: "Message created", data: await service.createGeneralDispatch(req.body, actorId(req), await resolveMessagingAccess(req)) }),
  listDispatches: async (req: Request, res: Response) => {
    const result = await service.listDispatches(req.query);
    return res.json({ message: "Messages", ...result });
  },
  getDispatch: async (req: Request, res: Response) =>
    res.json({ message: "Message", data: await service.getDispatch(idParam(req)) }),
  listRecipients: async (req: Request, res: Response) => {
    const result = await service.listDispatchRecipients(idParam(req), req.query, await resolveMessagingAccess(req));
    return res.json({ message: "Recipients", ...result });
  },
  cancel: async (req: Request, res: Response) =>
    res.json({ message: "Message cancelled", data: await service.cancelDispatch(idParam(req), await resolveMessagingAccess(req)) }),
  retryFailed: async (req: Request, res: Response) =>
    res.json({ message: "Retry queued", data: await service.retryFailed(idParam(req), await resolveMessagingAccess(req)) }),
};
