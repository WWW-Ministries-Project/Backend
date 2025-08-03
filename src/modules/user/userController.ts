import {Request, Response} from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import {prisma} from "../../Models/context";
import {
    sendEmail,
    comparePassword,
    hashPassword,
} from "../../utils";
import {UserService} from "./userService";
import {CourseService} from "../programs/courseService";
// import { forgetPasswordTemplate } from "../../utils/mail_templates/forgot-password";
// import { forgetPasswordTemplate } from "../../utils/mail_templates/forgetPasswordTemplate";
import {forgetPasswordTemplate} from "../../utils/mail_templates/forgotPasswordTemplate";
import {userActivatedTemplate} from "../../utils/mail_templates/userActivatedTemplate";
import {activateUserTemplate} from "../../utils/mail_templates/activateUserTemplate";


dotenv.config();

const JWT_SECRET: any = process.env.JWT_SECRET;
const userService = new UserService();
const courseService = new CourseService();

export const landingPage = async (req: Request, res: Response) => {
    res.send(
        // `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉💒</h1>`
        `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉🙏💒...</h1>`,
    );
};

const selectQuery = {
    id: true,
    name: true,
    email: true,
    membership_type: true,
    created_at: true,
    is_active: true,
    position_id: true,
    department_id: true,
    access_level_id: true,
    member_id: true,
    status: true,
    user_info: {
        select: {
            first_name: true,
            last_name: true,
            other_name: true,
            country_code: true,
            primary_number: true,
            title: true,
            photo: true,
            marital_status: true,
            nationality: true,
            state_region: true,
            city: true,
            date_of_birth: true,
            gender: true,
            country: true,
            occupation: true,
            company: true,
            address: true,
            member_since: true,
            emergency_contact: {
                select: {
                    name: true,
                    country_code: true,
                    phone_number: true,
                    relation: true,
                },
            },
            work_info: {
                select: {
                    name_of_institution: true,
                    industry: true,
                    position: true,
                },
            },
        },
    },
    department: {
        select: {
            department_info: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    },
    position: {
        select: {
            id: true,
            name: true,
        },
    },
};

export const registerUser = async (req: Request, res: Response) => {
    try {
        const {
            personal_info: {first_name} = {},

            contact_info: {email} = {},

            password,
            is_user,
        } = req.body;

        const existance = await prisma.user.findUnique({
            where: {email},
        });

        if (existance) {
            return res
                .status(404)
                .json({message: "User exist with this email " + email, data: null});
        }

        const response = await userService.registerUser(req.body);

        return res
            .status(201)
            .json({message: "User Created Successfully", data: response});
    } catch (error: any) {
        console.error(error);
        return res
            .status(500)
            .json({message: "Internal Server Error", data: error?.message});
    }
};

export const updateUser = async (req: Request, res: Response) => {
    try {
        const {user_id} = req.query;
        const {
            personal_info: {
                title,
                first_name,
                last_name,
                other_name,
                date_of_birth,
                gender,
                marital_status,
                nationality,
                has_children,
            } = {},
            picture = {},
            contact_info: {
                email,
                resident_country,
                state_region,
                city,
                phone: {country_code, number: primary_number} = {},
            } = {},
            work_info: {
                work_name,
                work_industry,
                work_position,
                school_name,
            } = {},
            emergency_contact: {
                name: emergency_contact_name,
                relation: emergency_contact_relation,
                phone: {
                    country_code: emergency_country_code,
                    number: emergency_phone_number,
                } = {},
            } = {},
            church_info: {
                membership_type,
                position_id,
                department_id,
                member_since
            } = {},
            children = [],
            status,
            is_user,
            department_positions,
        } = req.body;

        const userExists = await prisma.user.findUnique({
            where: {id: Number(user_id)},
            include: {
                user_info: {
                    include: {
                        work_info: true,
                        emergency_contact: true,
                    },
                },
            },
        });

        if (!userExists) {
            return res.status(400).json({message: "User not found", data: null});
        }

        const updatedUser = await prisma.user.update({
            where: {id: Number(user_id)},
            data: {
                name: `${first_name || userExists?.user_info?.first_name} ${
                    other_name || userExists?.user_info?.other_name || ""
                } ${last_name || userExists?.user_info?.last_name}`.trim(),
                email: email || userExists?.email,
                is_user: typeof is_user === "boolean" ? is_user : userExists?.is_user,
                status: status || userExists?.status,
                position_id: Number(position_id) || userExists?.position_id,
                department_id: Number(department_id) || userExists?.department_id,
                membership_type: membership_type || userExists?.membership_type,
                user_info: {
                    update: {
                        title,
                        first_name,
                        last_name,
                        other_name,
                        date_of_birth: date_of_birth
                            ? new Date(date_of_birth)
                            : undefined,
                        gender,
                        marital_status,
                        nationality,
                        photo: picture.src,
                        email,
                        country: resident_country,
                        state_region,
                        city,
                        country_code,
                        primary_number,
                        member_since: member_since ? new Date(member_since) : undefined,
                        emergency_contact: {
                            update: {
                                name: emergency_contact_name,
                                relation: emergency_contact_relation,
                                country_code: emergency_country_code,
                                phone_number: emergency_phone_number,
                            },
                        },
                        work_info: {
                            update: {
                                name_of_institution: work_name,
                                industry: work_industry,
                                position: work_position,
                                school_name,
                            },
                        },
                    },
                },
            },
            include: {
                user_info: {
                    select: {
                        photo: true,
                    },
                },
            },
        });

        let dep_posts, kids;

        // Handle department_positions update
        if (Array.isArray(department_positions) && department_positions.length > 0) {
            console.log("Stub: handle department updates here");
            dep_posts = await updateDepartmentPositions(Number(user_id), department_positions);
        }

        // Optional: handle children (currently stubbed)
        if (has_children && children.length > 0) {
            console.log("Stub: handle child updates here");
            kids = await updateChildren(children, updatedUser, membership_type, Number(user_id))
        }

        const {password, ...rest} = updatedUser

        const data = {
            parent: rest,
            department_positions: dep_posts,
            children: kids
        }

        return res
            .status(200)
            .json({message: "User updated successfully", data: data});
    } catch (error: any) {
        console.error(error);
        return res
            .status(500)
            .json({message: "Internal Server Error", data: error?.message});
    }
};

// Helper to update department_positions
async function updateDepartmentPositions(
    userId: number,
    department_positions: { department_id: any; position_id: any }[],
) {
    await prisma.department_positions.deleteMany({
        where: {user_id: userId},
    });
    console.log("Department positions to create:", department_positions.map(dp => ({
        user_id: userId,
        department_id: parseInt(dp.department_id),
        position_id: parseInt(dp.position_id),
    })));
    const created = await Promise.all(
        department_positions.map(dp =>
            prisma.department_positions.create({
                data: {
                    user_id: userId,
                    department_id: parseInt(dp.department_id),
                    position_id: parseInt(dp.position_id),
                },
            })
        )
    );
    console.log("Inserted department positions:", created);
    return created;
}

async function updateChildren(children: any[], parentObj: any, membership_type: string, userId: number) {
    await prisma.user.deleteMany({
        where: {parent_id: userId},
    });
    await userService.registerChildren(children, parentObj, membership_type)
}


export const updateUserSatus = async (req: Request, res: Response) => {
    const {id, is_active, status} = req.body;
    try {
        const response = await prisma.user.update({
            where: {
                id,
            },
            data: {
                is_active,
                status,
            },
            select: {
                id: true,
                is_active: true,
                member_id: true,
                status: true,
                name: true,
                email: true,
                password: true
            },
        });
        const email: any = response.email;
        const secret = JWT_SECRET + response.password;
        const token = JWT.sign(
            {
                id: response.id,
                email: response.email,
            },
            secret,
            {
                expiresIn: "7d",
            },
        );

        const link = `${process.env.Frontend_URL}/reset-password/?id=${response.id}&token=${token}`;

        const mailDetails = {
            user_name: response.name,
            link,
            expiration: "7days",
        };

        if (is_active) {
            sendEmail(userActivatedTemplate(mailDetails), email, "Reset Password");
        }

        const { password,  ...rest} = response

        return res
            .status(200)
            .json({message: "User Status Updated Succesfully", data: rest});
    } catch (error) {
        return res
            .status(500)
            .json({message: " Error updating User status " + error, data: null});
    }
};
export const deleteUser = async (req: Request, res: Response) => {
    try {
        const {id} = req.query;
        const existance = await prisma.user.findUnique({
            where: {
                id: Number(id),
            },
            select: {
                id: true,
            },
        });

        if (!existance) {
            return res.status(400).json({message: "No user found", data: null});
        }

        await prisma.user.delete({
            where: {
                id: Number(id),
            },
        });
        return res
            .status(200)
            .json({message: "User deleted Succesfully", data: null});
    } catch (error: any) {
        return res
            .status(500)
            .json({message: "Internal Server Error", data: error});
    }
};

export const login = async (req: Request, res: Response) => {
    const {email, password} = req.body;
    try {
        const existance: any = await prisma.user.findUnique({
            where: {
                email,
                // AND: {
                //     is_user: true, taking this one out because everyone can log in
                // },
            },
            select: {
                id: true,
                email: true,
                name: true,
                password: true,
                is_active: true,
                is_user : true,
                membership_type: true,
                department_positions: {
                    include:{
                         department: true,
                    },
                },
                user_info: {
                    select: {
                        photo: true,
                        member_since: true,
                        primary_number: true,
                    },
                },
                access: {
                    select: {
                        permissions: true,
                    },
                },
            },
        });

        if (!existance) {
            return res
                .status(404)
                .json({message: "No user with Email", data: null});
        }

        if (existance && existance.is_active === false) {
            return res.status(401).json({
                message: "Account is deactivated",
                data: null,
            });
        }

        const department: string[] = existance.department_positions.map((dept:any) => dept.department.name)
        const ministry_worker:boolean = Boolean(existance.access) && existance.is_user
        console.log("this is the ministry work thingy" + ministry_worker)
        if (await comparePassword(password, existance?.password)) {

            const token = JWT.sign(
                {
                    id: existance.id,
                    name: existance.name,
                    email: existance.email,
                    ministry_worker:ministry_worker,
                    permissions: existance.access?.permissions,
                    profile_img: existance.user_info?.photo,
                    membership_type: existance.membership_type || null,
                    department,
                    phone: existance.user_info?.primary_number || null,
                    member_since: existance.user_info?.member_since || null,
                },
                JWT_SECRET,
                {
                    expiresIn: "12h",
                },
            );

            return res
                .status(200)
                .json({status: "Login Successfully", token: token});
        } else {
            return res
                .status(401)
                .json({message: "Invalid Credentials", data: null});
        }
    } catch (error) {
        console.log(error);
        return res
            .status(500)
            .json({message: "Internal Server Error", data: error});
    }
};

export const changePassword = async (req: Request, res: Response) => {
    const {token, newpassword} = req.body;
    try {
        const user: any = JWT.verify(token, JWT_SECRET);
        const id = user.id;

        await prisma.user.update({
            where: {
                id,
            },
            data: {
                password: await hashPassword(newpassword),
            },
        });
        res
            .status(200)
            .json({message: "Password Changed Successfully", data: null});
    } catch (error) {
        return res
            .status(500)
            .json({message: "Internal Server Error", data: null});
    }
};

export const forgetPassword = async (req: Request, res: Response) => {
    const {email} = req.body;
    try {
        //check for the existence of an account using
        const existingUser = await prisma.user.findUnique({
            where: {
                email,
            },
        });

        if (!existingUser) {
            return res.status(400).json({error: "User Not Exists"});
        }
        const secret = JWT_SECRET + existingUser.password;
        const token = JWT.sign(
            {
                id: existingUser.id,
                email: existingUser.email,
            },
            secret,
            {
                expiresIn: "15m",
            },
        );

        const link = `${process.env.Frontend_URL}/reset-password/?id=${existingUser.id}&token=${token}`;
        const mailDetails = {
            user_name: existingUser.name,
            link,
            expiration: "15mins",
        };
        sendEmail(forgetPasswordTemplate(mailDetails), email, "Reset Password");
        return res
            .status(200)
            .json({message: `Link Send to your Mail`, data: null});
    } catch (error) {
        return res
            .status(500)
            .json({message: "Internal Server Error", data: null});
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    const {id, token} = req.query;
    const {newpassword} = req.body;
    //check for the existence of an account using
    try {
        const existingUser = await prisma.user.findUnique({
            where: {
                id: Number(id),
            },
        });
        if (!existingUser) {
            return res.status(404).json({message: "User Not Exists", data: null});
        }
        const secret = JWT_SECRET + existingUser.password;
        const verify = JWT.verify(token as string, secret);

        if (verify) {
            await prisma.user.update({
                where: {
                    id: Number(id),
                },
                data: {
                    password: await hashPassword(newpassword),
                },
            });
            return res
                .status(200)
                .json({message: "Password Successfully changed", data: null});
        }
    } catch (error) {
        return res.status(500).json({message: "Link Expired" + error, data: null});
    }
};

export const activateUser = async (req: Request, res: Response) => {
    const {user_id} = req.query;
    try {
        const existingUser = await prisma.user.findUnique({
            where: {
                id: Number(user_id),
            },
        });
        if (!existingUser) {
            return res.status(404).json({message: "User Not Exists", data: null});
        }

        const response = await prisma.user.update({
            where: {
                id: Number(user_id),
            },
            data: {
                is_user: !existingUser.is_user,
            },
        });

        if (response.is_user){
            sendEmail(
                activateUserTemplate({user_name: existingUser.name}),
                existingUser.email || "",
                "User Activation",
            );
        }


        return res
            .status(200)
            .json({message: "User Activated Successfully", data: response});
    } catch (error) {
        return res.status(500).json({message: "Operation Failed", data: error});
    }
};

export const seedUser = async (req: Request, res: Response) => {
    try {
        const response = await prisma.user.create({
            data: {
                name: "Ordinary Member",
                email: "member@member.com",
                password:
                    "$2b$10$2EYtobxw11Tk1.JXCjplJOQ5mgu1dmNENtbDnpcQiqjnkSgyRrZqu",
                is_user: true,
            },
            select: {
                email: true,
                name: true,
            },
        });
        res
            .status(200)
            .json({message: "User Created Succesfully", data: response});
    } catch (error) {
        return res
            .status(500)
            .json({message: "Something went wrong", data: error});
    }
};
export const ListUsers = async (req: Request, res: Response) => {
    const {is_user, department_id, page = "1", limit = "10", is_active, name} = req.query;
    const isUser = is_user === "true";

    const pageNum = parseInt(page as string, 10);
    const pageSize = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * pageSize;

    try {
        const departments = await prisma.department.findMany({
            select: {
                id: true,
                name: true,
            },
        });

        const departmentMap = new Map(departments.map((d) => [d.id, d.name]));

        const whereFilter: any = {};

        if (is_active !== undefined) whereFilter.is_active = is_active;
        if (is_user !== undefined) whereFilter.is_user = isUser;
        if (department_id) whereFilter.department_id = Number(department_id);
        if (typeof name === "string" && name.trim()) {
            whereFilter.name = { contains: name.trim() };
        }

        console.log(whereFilter)

        const total = await prisma.user.count({where: whereFilter});

        const users = await prisma.user.findMany({
            skip,
            take: pageSize,
            orderBy: {
                name: "asc",
            },
            where: whereFilter,
            select: {
                id: true,
                name: true,
                email: true,
                member_id: true,
                created_at: true,
                is_active: true,
                is_user: true,
                department_id: true,
                membership_type: true,
                status: true,
                user_info: {
                    select: {
                        country_code: true,
                        primary_number: true,
                        title: true,
                        photo: true,
                    },
                },
                department: {
                    select: {
                        department_info: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
                position: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        const usersWithDeptName = users.map((user: any) => ({
            ...user,
            department_name: departmentMap.get(user.department_id) || null,
        }));

        const destructure = (data: any[]) => {
            return data.map(({user_info, ...rest}) => ({
                ...rest,
                ...user_info,
            }));
        };

        res.status(200).json({
            message: "Operation Successful",
            current_page:pageNum,
            page_size:pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            data: destructure(usersWithDeptName),
        });
    } catch (error) {
        return res
            .status(500)
            .json({message: "Something Went Wrong", error});
    }
};

export const getUser = async (req: Request, res: Response) => {
    const {user_id} = req.query;

    try {
        const response: any = await prisma.user.findUnique({
            where: {
                id: Number(user_id),
            },
            select: {
                id: true,
                name: true,
                email: true,
                membership_type: true,
                created_at: true,
                is_active: true,
                position_id: true,
                department_id: true,
                access_level_id: true,
                status: true,
                is_user: true,
                member_id: true,
                user_info: {
                    select: {
                        first_name: true,
                        last_name: true,
                        other_name: true,
                        country_code: true,
                        primary_number: true,
                        title: true,
                        photo: true,
                        state_region: true,
                        city: true,
                        marital_status: true,
                        member_since: true,
                        nationality: true,
                        date_of_birth: true,
                        gender: true,
                        country: true,
                        occupation: true,
                        company: true,
                        address: true,
                        emergency_contact: {
                            select: {
                                name: true,
                                country_code: true,
                                phone_number: true,
                                relation: true,
                            },
                        },
                        work_info: {
                            select: {
                                name_of_institution: true,
                                industry: true,
                                position: true,
                            },
                        },
                    },
                },
                department: {
                    select: {
                        department_info: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
                position: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                access: true,
                enrollments: {
                    select: {
                        id: true,
                        course: {
                            select: {
                                id: true,
                                name: true,
                                instructor: true,
                                cohort: {
                                    select: {
                                        id: true,
                                        name: true,
                                        status: true,
                                        program: {
                                            select: {
                                                id: true,
                                                title: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        progress: {
                            select: {
                                id: true,
                                topic: {
                                    select: {
                                        id: true,
                                        name: true,
                                    },
                                },
                                status: true,
                            },
                        },
                    },
                },
                children: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        membership_type: true,
                        created_at: true,
                        status: true,
                        user_info: {
                            select: {
                                first_name: true,
                                last_name: true,
                                other_name: true,
                                date_of_birth: true,
                                gender: true,
                                nationality: true,
                                marital_status:true,
                                title: true,
                            },
                        },
                    },
                },
                parent: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        membership_type: true,
                        created_at: true,
                        user_info: {
                            select: {
                                first_name: true,
                                last_name: true,
                                other_name: true,
                                date_of_birth: true,
                                gender: true,
                                nationality: true,
                            },
                        },
                    },
                },
                department_positions: {
                    include: {
                        department: true,
                        position: true,
                    },
                },
            },
        });

        if (!response) {
            return res.status(404).json({message: "User not found"});
        }

        // Flatten user_info and others
        const {
            user_info,
            parent,
            children,
            department_positions,
            ...rest
        } = response;
        const user = {...rest, ...user_info};

        // Flatten parent user_info
        if (parent?.user_info) {
            user.parent = {...parent, ...parent.user_info};
            delete user.parent.user_info;
        }

        // Flatten each child’s user_info
        if (children && Array.isArray(children)) {
            user.children = children.map((child) => {
                if (child.user_info) {
                    const {user_info, ...restChild} = child;
                    return {...restChild, ...user_info};
                }
                return child;
            });
        }

        // Flatten department_positions
        if (department_positions && Array.isArray(department_positions)) {
            user.department_positions = department_positions.map((dp) => ({
                department_name: dp.department?.name ?? null,
                position_name: dp.position?.name ?? null,
            }));
        }

        res.status(200).json({
            message: "Operation Successful",
            data: user,
        });
    } catch (error) {
        return res.status(500).json({
            message: "Operation failed",
            data: error,
        });
    }
};

export const statsUsers = async (req: Request, res: Response) => {
    try {
        interface Stats {
            Total: number;
            Male: number;
            Female: number;
            Other: number;
        }

        interface CategoryStats {
            children: Stats;
            adults: Stats;
        }

        const allUserInfos_members = await prisma.user_info.findMany({
            where: {
                user: {
                    membership_type: "ONLINE",
                },
            },
        });
        const allUserInfos_visitors = await prisma.user_info.findMany({
            where: {
                user: {
                    membership_type: "IN_HOUSE",
                },
            },
        });
        const allUserInfosByCategory = allUserInfos_members.reduce(
            (acc: any, cur: any) => {
                const gender = cur.gender || "other";

                acc.total++;
                acc[gender]++;

                return acc;
            },
            {total: 0, Male: 0, Female: 0, other: 0},
        );

        const stats: CategoryStats = allUserInfos_members.reduce(
            (acc: any, user: any) => {
                const age =
                    Number(new Date().getFullYear()) -
                    Number(user.date_of_birth?.getFullYear());
                const category = age <= 18 ? "children" : "adults";
                const gender = user.gender || "other";

                acc[category].Total++;
                acc[category][gender]++;

                return acc;
            },
            {
                children: {Total: 0, Male: 0, Female: 0, other: 0},
                adults: {Total: 0, Male: 0, Female: 0, other: 0},
            },
        );

        const visitorInfosByCategory = allUserInfos_visitors.reduce(
            (acc: any, cur: any) => {
                const gender = cur.gender || "other";

                acc.total++;
                acc[gender]++;

                return acc;
            },
            {total: 0, Male: 0, Female: 0, other: 0},
        );

        const visitor_stats: CategoryStats = allUserInfos_visitors.reduce(
            (acc: any, user: any) => {
                const age =
                    Number(new Date().getFullYear()) -
                    Number(user.date_of_birth?.getFullYear());
                const category = age <= 18 ? "children" : "adults";
                const gender = user.gender || "other";

                acc[category].Total++;
                acc[category][gender]++;

                return acc;
            },
            {
                children: {Total: 0, Male: 0, Female: 0, other: 0},
                adults: {Total: 0, Male: 0, Female: 0, other: 0},
            },
        );

        return res.status(202).json({
            message: "Operation Sucessful",
            data: {
                online: {
                    total_members: allUserInfosByCategory.total,
                    total_males: allUserInfosByCategory.Male,
                    total_females: allUserInfosByCategory.Female,
                    total_others: allUserInfosByCategory.other,
                    stats: stats,
                },
                inhouse: {
                    total_members: visitorInfosByCategory.total,
                    total_males: visitorInfosByCategory.Male,
                    total_females: visitorInfosByCategory.Female,
                    total_others: visitorInfosByCategory.other,
                    stats: visitor_stats,
                },
            },
        });
    } catch (error) {
        return res
            .status(500)
            .json({message: "Internal Server Error", data: error});
    }
};

export const getUserByEmailPhone = async (req: Request, res: Response) => {
    const {email, cohortId} = req.query;

    try {
        let user = null;
        let courses: any[] = [];

        // If email is passed, find user
        if (email) {
            user = await prisma.user_info.findFirst({
                where: {
                    OR: [{email: email as string}, {primary_number: email as string}],
                },
                select: {
                    user_id: true,
                    first_name: true,
                    last_name: true,
                    other_name: true,
                    email: true,
                    country_code: true,
                    primary_number: true,
                    title: true,
                    user: {
                        select: {
                            membership_type: true,
                            status: true,
                        },
                    },
                },
            });
        }

        // If cohortId is passed, get courses
        if (cohortId) {
            courses = await courseService.getAllCourses(Number(cohortId));
        }

        // If no params were passed
        if (!email && !cohortId) {
            return res.status(400).json({
                message:
                    "At least one query parameter (email or cohortId) must be provided.",
            });
        }

        // If email was provided but no user found
        if (email && !user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        return res.status(200).json({
            message: "Operation successful",
            data: {
                user,
                courses,
            },
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            message: "Operation failed",
            data: error,
        });
    }
};

export const convertMemeberToConfirmedMember = async (
    req: Request,
    res: Response,
) => {
    const {user_id} = req.query;

    try {
        const result = await userService.convertMemeberToConfirmedMember(
            Number(user_id),
        );
        if (result.error == "") {
            return res.status(400).json({
                message: "Operation failed",
                data: result,
            });
        }
        return res.status(200).json({
            message: "Operation successful",
            data: result,
        });
    } catch (error) {
        return res.status(500).json({
            message: "Operation failed",
            data: error,
        });
    }
};

export const linkSpouses = async (req: Request, res: Response) => {
    try {
        const {husband, wife} = req.body;
        const result = await userService.linkSpouses(Number(husband), Number(wife));
        if (result.error == "") {
            return res.status(400).json({
                message: "Operation failed",
                data: result,
            });
        }
        return res.status(200).json({
            message: "Operation successful",
            data: result,
        });
    } catch (error: any) {
        return res.status(500).json({
            message: "Operation failed",
            data: error.message,
        });
    }
};

export const getUserFamily = async (req: Request, res: Response) => {
    try {
        const {user_id} = req.query;

        const family = await userService.getUserFamily(Number(user_id));

        if (!family) {
            return res.status(404).json({
                message: "",
                data: "Error in getting the family",
            });
        }

        return res.status(200).json({
            message: "Operation Successfull",
            data: family,
        });
    } catch (error: any) {
        return res.status(500).json({
            message: "Operation failed",
            data: error,
        });
    }
};

export const linkChildren = async (req: Request, res: Response) => {
    try {
        const {childrenIds, parentId} = req.body;

        if (Array.isArray(childrenIds) && childrenIds.length > 0) {
            const result = await userService.linkChildren(childrenIds, parentId);
            if (result) {
                return {message: "Operation Sucess", data: result};
            }

            return {
                message: "Operation Failed",
                data: "Something Happened, Contact Eshun",
            };
        }

        return {
            message: "Operation Failed",
            data: "We expect the children Id to be an Array",
        };
    } catch (error) {
        console.error("Error linking children:", error);
        throw error;
    }
};

export const currentuser = async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({message: "Authorization header missing or invalid."});
        }

        const token = authHeader.split(" ")[1];
        const decoded: any = JWT.verify(token, JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: {id: decoded.id},
            include: {
                user_info: true,
                department_positions: {
                    include: {
                        department: true,
                    },
                },
            },

        });

        if (!user) {
            return res.status(404).json({message: "User not found."});
        }

        const department: string[] = user.department_positions.map((dept) => dept.department.name)

        const data = {
            name: user.name,
            email: user.email,
            phone: user.user_info?.primary_number || null,
            member_since: user.user_info?.member_since || null,
            department,
            membership_type: user.membership_type || null,
        }

        return res.json({message: "Operation sucessful", data: data})
    } catch (error) {
        return res.status(401).json({message: "Unauthorized", error});
    }
};


// export const generateAndSendRandomOTP = async (req: Request, res: Response) => {
//   try {
//     const {email} = req.query;

//     // Validate email parameter
//     if (!email || typeof email !== "string") {
//       return res.status(400).json({ message: "Email is required in query params" });
//     }

//     const email_address = email.toLowerCase();

//     const user = await prisma.user.findUnique({
//       where: { email: email_address },
//     });

//     if (!user) {
//       return res
//         .status(404)
//         .json({ message: `No user exists with email ${email}`, data: null });
//     }

//     // Generate OTP
//     const OTP = generateRandomOTP();

//     // Send OTP email
//     await sendEmail({
//       to: email,
//       subject: "Your OTP Code",
//       text: `Your OTP is: ${OTP}`,
//     });

//     // Optional: Save OTP in DB or cache for verification later
//     // await prisma.otp.create({
//     //   data: { email, code: OTP, expiresAt: new Date(Date.now() + 5 * 60 * 1000) }
//     // });

//     return res.status(200).json({
//       message: "OTP sent successfully",
//       data: { email, OTP },
//     });
//   } catch (error) {
//     console.error("Error sending OTP:", error);
//     return res.status(500).json({ message: "Unable to send OTP", error });
//   }
// };