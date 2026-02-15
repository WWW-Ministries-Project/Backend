// import { Request, Response } from "express";
// import {  bankAccountConfigurationService }  from "./service";

// const bankAccountConfigService = new bankAccountConfigurationService();

// export class BankAccountConfigController {
//   async create(req: Request, res: Response) {
//     try {
//       const config = await bankAccountConfigService.create(req.body);

//       return res.status(201).json({
//         message: "Payment configuration created successfully",
//         data: config,
//       });
//     } catch (error: any) {
//       return res.status(400).json({
//         message: "Failed to create payment configuration",
//         error: error.message,
//       });
//     }
//   }

//   async findAll(req: Request, res: Response) {
//       const configs = await bankAccountConfigService.findAll();

//     return res.status(200).json({
//       data: configs,
//     });
//   }

//   async findById(req: Request, res: Response) {
//     const { id } = req.query;

//     if (!id || typeof id !== "string") {
//       return res.status(400).json({ message: "Invalid payment configuration ID" });
//     }

//     const config = await bankAccountConfigService.findById(id);

//     if (!config) {
//       return res.status(404).json({
//         message: "Payment configuration not found",
//       });
//     }

//     return res.status(200).json({
//       data: config,
//     });
//   }

//   async update(req: Request, res: Response) {
//     const { id } = req.query;

//     if (!id || typeof id !== "string") {
//       return res.status(400).json({ message: "Invalid payment configuration ID" });
//     }

//     try {
//       const updatedConfig = await bankAccountConfigService.update(id, req.body);

//       return res.status(200).json({
//         message: "Payment configuration updated successfully",
//         data: updatedConfig,
//       });
//     } catch (error: any) {
//       return res.status(400).json({
//         message: "Failed to update payment configuration",
//         error: error.message,
//       });
//     }
//   }

//   async delete(req: Request, res: Response) {
//     const { id } = req.query;

//     if (!id || typeof id !== "string") {
//       return res.status(400).json({ message: "Invalid payment configuration ID" });
//     }

//     await bankAccountConfigService.delete(id);

//     return res.status(204).send();
//   }
// }
