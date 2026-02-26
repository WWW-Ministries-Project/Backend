import Router from "express";
import * as dotenv from "dotenv";
import {
  createPosition,
  updatePosition,
  deletePosition,
  listPositions,
  getPosition,
  listPositionsLight,
} from "./positionController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();
const protect = permissions.protect;

dotenv.config();
export const positionRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Positions
 *   description: Position management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Position:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: Senior Pastor
 *         description:
 *           type: string
 *           example: Oversees the church's pastoral operations
 *         department:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 2
 *             name:
 *               type: string
 *               example: Ministry
 *     CreatePositionRequest:
 *       type: object
 *       required:
 *         - name
 *         - department_id
 *       properties:
 *         name:
 *           type: string
 *           example: Senior Pastor
 *         department_id:
 *           type: integer
 *           example: 2
 *         description:
 *           type: string
 *           example: Oversees the church's pastoral operations
 *         created_by:
 *           type: integer
 *           example: 3
 *     UpdatePositionRequest:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - department_id
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: Associate Pastor
 *         department_id:
 *           type: integer
 *           example: 2
 *         description:
 *           type: string
 *           example: Assists the Senior Pastor in church operations
 *         updated_by:
 *           type: integer
 *           example: 3
 */

/**
 * @swagger
 * /position/create-position:
 *   post:
 *     summary: Create a new position
 *     tags: [Positions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePositionRequest'
 *     responses:
 *       200:
 *         description: Position created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Position Created Successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Position'
 */
positionRouter.post(
  "/create-position",
  [protect, permissions.can_manage_positions],
  createPosition,
);

/**
 * @swagger
 * /position/update-position:
 *   put:
 *     summary: Update an existing position
 *     tags: [Positions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePositionRequest'
 *     responses:
 *       200:
 *         description: Position updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Position Updated Successfully
 *                 data:
 *                   $ref: '#/components/schemas/Position'
 */
positionRouter.put(
  "/update-position",
  [protect, permissions.can_manage_positions],
  updatePosition,
);

/**
 * @swagger
 * /position/delete-position:
 *   delete:
 *     summary: Delete a position by ID
 *     tags: [Positions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the position to delete
 *     responses:
 *       200:
 *         description: Position deleted successfully
 */
positionRouter.delete(
  "/delete-position",
  [protect, permissions.can_delete_positions],
  deletePosition,
);

/**
 * @swagger
 * /position/list-positions:
 *   get:
 *     summary: List all positions (paginated)
 *     tags: [Positions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: take
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of positions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 current_page:
 *                   type: integer
 *                 page_size:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Position'
 */
positionRouter.get(
  "/list-positions",
  [protect],
  listPositions,
);

/**
 * @swagger
 * /position/get-position:
 *   get:
 *     summary: Get details of a position by ID
 *     tags: [Positions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the position to retrieve
 *     responses:
 *       200:
 *         description: Position details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   $ref: '#/components/schemas/Position'
 */
positionRouter.get(
  "/get-position",
  [protect, permissions.can_view_positions],
  getPosition,
);

positionRouter.get(
  "/get-positions-light",
  [protect, permissions.can_view_positions],
  listPositionsLight,
);
