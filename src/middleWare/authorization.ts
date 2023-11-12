import { Request, Response, NextFunction } from "express";

import JWT from "jsonwebtoken";


export const protect = (req: any, res: Response, next: NextFunction) => {
    const token = req.headers["authorization"]?.split(" ")[1];
  
    if (!token) return res.status(401).json({ message: "Not authorized. Token not found", data: null })

    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: "Session Expired" });
    }
  };

  export const can_view_users = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];

    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.homepage.users.view_users) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to view users", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  export const can_manage_users = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];

    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.homepage.users.manage_users) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to manage users", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };


  export const can_view_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.settings.department.view_departments) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to view departments", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  

  export const can_manage_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];
  
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.settings.department.manage_departments) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to manage departments", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  
  export const can_manage_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];
  
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.settings.positions.manage_positions) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to manage positions", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  export const can_view_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];
    
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.settings.positions.view_positions) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to view positions", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
 
  export const can_manage_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];
    
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.settings.access_level.manage_access_level) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to manage access levels", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  export const can_view_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers['authorization']?.split(' ')[1];
    
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      const permission = decoded.permissions;
  
      if (permission.settings.access_level.view_access_level) {
        next();
      } else {
        return res.status(401).json({ message: "Not authorized to view access levels", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };