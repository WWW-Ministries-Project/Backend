import {prisma} from "../../Models/context";
import {Request, Response} from "express";
import {departmentSchema, toCapitalizeEachWord} from "../../utils";

export const createDepartment = async (req: Request, res: Response) => {
    const {name, department_head, description, created_by} = req.body;
    departmentSchema.validate(req.body)
    try {
        if (!name || name.trim() === "") {
            return res.status(400).json({
                message: "Empty Department Name",
                data: null,
            });
        }
        const existing = await prisma.department.findFirst({
                where: {
                    name: toCapitalizeEachWord(name)
                }
            }
        )
        if (existing) {
            return res.status(400).json({
                message: "Department Name already exist",
                data: null,
            });
        }

        await prisma.department.create({
            data: {
                name: toCapitalizeEachWord(name),
                department_head,
                description,
                created_by,
            },
        });

        const data = await prisma.department.findMany({
            orderBy: {
                id: "desc",
            },
            select: {
                id: true,
                name: true,
                description: true,
                department_head_info: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        res
            .status(200)
            .json({message: "Department Created Succesfully", data: data});
    } catch (error: any) {
        return res
            .status(500)
            .json({message: "Department failed to create", data: error});
    }
};

export const updateDepartment = async (req: Request, res: Response) => {
    const {id, name, department_head, description, updated_by} = req.body;

    try {

        if (!name || name.trim() === "") {
            return res.status(400).json({
                message: "We cannot have an empty department name, you get it?",
                data: null,
            });
        }

        const response = await prisma.department.update({
            where: {
                id,
            },
            data: {
                name: toCapitalizeEachWord(name),
                department_head,
                description,
                updated_by,
                updated_at: new Date(),
                is_sync: false, //setting to to out of sync for cron job to sync to device
            },
            select: {
                id: true,
                name: true,
                description: true,
                department_head_info: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        res
            .status(200)
            .json({message: "Department Updated Succesfully", data: response});
    } catch (error) {
        return res
            .status(503)
            .json({message: "Department failed to update", data: error});
    }
};

export const deleteDepartment = async (req: Request, res: Response) => {
    const {id} = req.query;

    try {
         await prisma.department.delete({
            where: {
                id: Number(id),
            },
        });
        const data = await prisma.department.findMany({
            orderBy: {
                id: "desc",
            },
            select: {
                id: true,
                name: true,
                description: true,
                department_head_info: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        res
            .status(200)
            .json({message: "Department Deleted Succesfully", data: data});
    } catch (error) {
        return res
            .status(503)
            .json({message: "Department failed to delete", data: error});
    }
};

export const listDepartments = async (req: Request, res: Response) => {
    try {
        const response = await prisma.department.findMany({
            orderBy: {
                name: "asc",
            },
            select: {
                id: true,
                name: true,
                description: true,
                department_head_info: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                position: {
                    orderBy: {
                        name: 'asc',
                    },
                    select: {
                        id: true,
                        name: true,
                    }
                }
            },
        });
        res.status(200).json({message: "Success", data: response});
    } catch (error) {
        return res
            .status(503)
            .json({message: "Department failed to fetch", data: error});
    }
};

export const getDepartment = async (req: Request, res: Response) => {
    const {id} = req.body;

    try {
        const response = await prisma.department.findUnique({
            where: {
                id,
            },
            select: {
                id: true,
                name: true,
                description: true,
                department_head_info: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!response) {
            res.status(200).json({message: "No department found", data: response});
        }

        res.status(200).json({message: "Success", data: response});
    } catch (error) {
        return res
            .status(503)
            .json({message: "No Department Found", data: error});
    }
};
