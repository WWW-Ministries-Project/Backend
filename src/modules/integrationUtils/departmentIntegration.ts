import * as dotenv from "dotenv";
const axios = require("axios");

interface DepatmentPayload {
  dept_name: string;
  dept_code: string;
}

const host: any = process.env.ZKtecoHost;

export class ZKTecoDepartment {
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

  createDepartment = async function name(
    params: DepatmentPayload,
    token: string,
  ) {
    const url = `${host}/personnel/api/departments/`;
    console.log(url)
    try {
      const response = await axios.post(url, params, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("Department Fetch Response:", response.data);
      return response.data;
    } catch (error: any) {
      console.error(
        "Error fetching department:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  updateDepartment = async function name(
    id: number,
    params: DepatmentPayload,
    token: string,
  ) {
    const url = `${host}/personnel/api/departments/${id}/`;
    console.log("url" + url);
    try {
      const response = await axios.put(url, params, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.data) {
        console.log("Department Update Sucessfully", response.data.id);
      }
      return response.data;
    } catch (error: any) {
      console.error(
        "Error fetching employee:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  getSingleDepartment = async function name(id: number | null, token: string) {
    if (id == null) {
      return;
    }
    const url = `${host}/personnel/api/departments/${id}`;
    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.data) {
        console.log("Department Retrieved Sucessfully", response.data.id);
        return response;
      }
    } catch (error: any) {
      console.error(
        "Error fetching employee:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  deleteDepartment = async function name(id: number, token: string) {
    const url = `${host}/personnel/api/departments/${id}`;
    try {
      const response = await axios.delete(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error: any) {
      console.error(
        "Error fetching employee:",
        error.response?.data || error.message,
      );
      return null;
    }
  };
}
