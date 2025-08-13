import Router from "express";
import * as dotenv from "dotenv";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  getDepartment,
  listDepartmentsLight,
} from "./departmentController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;

dotenv.config();
export const departmentRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Departments
 *   description: Department management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Department:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: Finance
 *         description:
 *           type: string
 *           example: Handles all company finances
 *         department_head_info:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 5
 *             name:
 *               type: string
 *               example: John Doe
 *     CreateDepartmentRequest:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: Finance
 *         department_head:
 *           type: integer
 *           example: 5
 *         description:
 *           type: string
 *           example: Handles all company finances
 *         created_by:
 *           type: integer
 *           example: 3
 *     UpdateDepartmentRequest:
 *       type: object
 *       required:
 *         - id
 *         - name
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: Operations
 *         department_head:
 *           type: integer
 *           example: 5
 *         description:
 *           type: string
 *           example: Oversees company operations
 *         updated_by:
 *           type: integer
 *           example: 3
 */

/**
 * @swagger
 * /department/create-department:
 *   post:
 *     summary: Create a new department
 *     tags: [Departments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDepartmentRequest'
 *     responses:
 *       200:
 *         description: Department created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Department Created Successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Department'
 */
departmentRouter.post(
  "/create-department",
  [permissions.protect, permissions.can_manage_department],
  createDepartment,
);
/**
 * @swagger
 * /department/update-department:
 *   put:
 *     summary: Update an existing department
 *     tags: [Departments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateDepartmentRequest'
 *     responses:
 *       200:
 *         description: Department updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Department Updated Successfully
 *                 data:
 *                   $ref: '#/components/schemas/Department'
 */
departmentRouter.put(
  "/update-department",
  [protect, permissions.can_manage_department],
  updateDepartment,
);
/**
 * @swagger
 * /department/delete-department:
 *   delete:
 *     summary: Delete a department by ID
 *     tags: [Departments]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the department to delete
 *     responses:
 *       200:
 *         description: Department deleted successfully
 */

departmentRouter.delete(
  "/delete-department",
  [protect, permissions.can_delete_department],
  deleteDepartment,
);

/**
 * @swagger
 * /department/list-departments:
 *   get:
 *     summary: List all departments (paginated)
 *     tags: [Departments]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of departments
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
 *                     $ref: '#/components/schemas/Department'
 */
departmentRouter.get(
  "/list-departments",
  [protect, permissions.can_view_department],
  listDepartments,
);
/**
 * @swagger
 * /department/get-department:
 *   get:
 *     summary: Get details of a department by ID
 *     tags: [Departments]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the department to retrieve
 *     responses:
 *       200:
 *         description: Department details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   $ref: '#/components/schemas/Department'
 */
departmentRouter.get(
  "/get-department",
  [protect, permissions.can_view_department],
  getDepartment,
);

departmentRouter.get(
  "/list-departments-light",
  [protect, permissions.can_view_department],
  listDepartmentsLight,
);
