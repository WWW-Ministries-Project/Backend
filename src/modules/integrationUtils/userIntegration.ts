import * as dotenv from "dotenv";
const axios = require("axios");

interface UserPayload {
  id: string;
  department: number;
  area: number[];
  hire_date?: string;
  first_name?: string;
  last_name?: string;
  gender?: string;
  mobile?: string;
  national?: string;
  address?: string;
  email?: string;
  app_status?: number;
}

interface DepatmentPayload {
  dept_name: string;
  dept_code: string;
}

const host: any = process.env.ZKtecoHost;

export class ZKTeco {
  userAuthentication = async function postAuth() {
    try {
      if (!host) throw new Error("Host URL is not defined");

      // Get Authentication Token
      const url = `${host}/jwt-api-token-auth/`;
      const payload = {
        username: "clementk",
        password: "P@$$W0rd1",
      };

      const response = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log("Auth Response:", response.data);
      return response.data;
    } catch (error: any) {
      console.error(
        "Error in authentication:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  createUser = async function (payload: UserPayload, token: string) {
    const url = `${host}/personnel/api/employees/`;

    const requestBody = {
      emp_code: payload.id.toString(),
      ...payload,
    };
    console.log(requestBody);
    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("Employee Creation Response:", response.data);
      return response.data
    } catch (error: any) {
      console.error(
        "Error creating employee:",
        error.response?.data || error.message,
      );
      return null; // Return a fallback value instead of undefined
    }
  };

  getSingleUser = async function (id: number, token: string) {
    const url = `${host}/personnel/api/employee/${id}`;

    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("Employee Fetch Response:", response.data);
      return response.data;
    } catch (error: any) {
      console.error(
        "Error fetching employee:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  createDepartment = async function name(
    params: DepatmentPayload,
    token: string,
  ) {
    const url = `${host}/personnel/api/departments/`;
    try {
      const response = await axios.post(url, params, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("Employee Fetch Response:", response.data);
      return response.data;
    } catch (error: any) {
      console.error(
        "Error fetching employee:",
        error.response?.data || error.message,
      );
      return null;
    }
  };
}
