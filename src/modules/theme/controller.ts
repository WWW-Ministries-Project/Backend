import { Request, Response } from "express";
import { AnnualThemeService } from "./service";

const annualThemeService = new AnnualThemeService();

export class AnnualThemeController {
  async create(req: Request, res: Response) {
    try {
      const theme = await annualThemeService.create(req.body);

      return res.status(201).json({
        message: "Annual theme created successfully",
        data: theme,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: "Failed to create annual theme",
        error: error.message,
      });
    }
  }

  async findAll(req: Request, res: Response) {
    const themes = await annualThemeService.findAll();

    return res.status(200).json({
      data: themes,
    });
  }

  async findActive(req: Request, res: Response) {
    const theme = await annualThemeService.findActive();

    return res.status(200).json({
      data: theme,
    });
  }

  async findById(req: Request, res: Response) {
    const { id } = req.query;

    const theme = await annualThemeService.findById(Number(id));

    if (!theme) {
      return res.status(404).json({
        message: "Annual theme not found",
      });
    }

    return res.status(200).json({
      data: theme,
    });
  }

  async update(req: Request, res: Response) {
    const { id } = req.query;

    try {
      const updatedTheme = await annualThemeService.update(
        Number(id),
        req.body,
      );

      return res.status(200).json({
        message: "Annual theme updated successfully",
        data: updatedTheme,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: "Failed to update annual theme",
        error: error.message,
      });
    }
  }

  async delete(req: Request, res: Response) {
    const { id } = req.query;

    await annualThemeService.delete(Number(id));

    return res.status(204).send();
  }
}
