import * as dotenv from "dotenv";
const axios = require("axios");

interface PositionPayload {
  position_code: string;
  position_name: string;
}

const host: any = process.env.ZKtecoHost;

export class ZKTecoPosition {
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

  createPosition = async function name(params: PositionPayload, token: string) {
    const url = `${host}/personnel/api/positions/`;
    try {
      const response = await axios.post(url, params, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("Position Fetch Response:", response.data);
      return response.data;
    } catch (error: any) {
      console.error(
        "Error fetching positions:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  updatePosition = async function name(
    id: number,
    params: PositionPayload,
    token: string,
  ) {
    const url = `${host}/personnel/api/positions/${id}/`;
    try {
      const response = await axios.post(url, params, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.data) {
        console.log("Position Update Sucessfully", response.data.id);
      }
    } catch (error: any) {
      console.error(
        "Error fetching positions:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  getSinglePosition = async function name(id: number, token: string) {
    const url = `${host}/personnel/api/positions/${id}/`;
    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.data) {
        console.log("Position Retrieved Sucessfully", response.data.id);
        return response;
      }
    } catch (error: any) {
      console.error(
        "Error fetching positions:",
        error.response?.data || error.message,
      );
      return null;
    }
  };

  deletePosition = async function name(id: number, token: string) {
    const url = `${host}/personnel/api/positions/${id}/`;
    try {
      const response = await axios.delete(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error: any) {
      console.error(
        "Error fetching position:",
        error.response?.data || error.message,
      );
      return null;
    }
  };
}
