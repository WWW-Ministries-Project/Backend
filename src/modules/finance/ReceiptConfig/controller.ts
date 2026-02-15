// import { Request, Response } from "express";
// import {  receiptConfigurationService }  from "./service";

// const receiptConfigService = new receiptConfigurationService();

// export class ReceiptConfigController {
//   async create(req: Request, res: Response) {
//     try {
//       const config = await receiptConfigService.create(req.body);

//       return res.status(201).json({
//         message: "Receipt configuration created successfully",
//         data: config,
//       });
//     } catch (error: any) {
//       return res.status(400).json({
//         message: "Failed to create receipt configuration",
//         error: error.message,
//       });
//     }
//   }

//   async findAll(req: Request, res: Response) {
//       const configs = await receiptConfigService.findAll();

//     return res.status(200).json({
//       data: configs,
//     });
//   }

//   async findById(req: Request, res: Response) {
//     const { id } = req.query;

//     if (!id || typeof id !== "string") {
//       return res.status(400).json({ message: "Invalid finance configuration ID" });
//     }

//     const config = await receiptConfigService.findById(id);

//     if (!config) {
//       return res.status(404).json({
//         message: "Receipt configuration not found",
//       });
//     }

//     return res.status(200).json({
//       data: config,
//     });
//   }

//   async update(req: Request, res: Response) {
//     const { id } = req.query;

//     if (!id || typeof id !== "string") {
//       return res.status(400).json({ message: "Invalid finance configuration ID" });
//     }

//     try {
//       const updatedConfig = await receiptConfigService.update(id, req.body);

//       return res.status(200).json({
//         message: "Receipt configuration updated successfully",
//         data: updatedConfig,
//       });
//     } catch (error: any) {
//       return res.status(400).json({
//         message: "Failed to update receipt configuration",
//         error: error.message,
//       });
//     }
//   }

//   async delete(req: Request, res: Response) {
//     const { id } = req.query;

//     if (!id || typeof id !== "string") {
//       return res.status(400).json({ message: "Invalid finance configuration ID" });
//     }

//     await receiptConfigService.delete(id);

//     return res.status(204).send();
//   }
// }
