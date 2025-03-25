import * as dotenv from "dotenv";
const axios = require("axios");

const host: any = process.env.ZKtecoHost;
const zkUser: any = process.env.ZKtecoUser;
const zkPassword: any = process.env.ZKtecoPassword;


export class ZKTecoAuth {
userAuthentication = async function postAuth() {
    try {
      if (!host) throw new Error("Host URL is not defined");

      // Get Authentication Token
      const url = `${host}/jwt-api-token-auth/`;
      const payload = {
        username: zkUser,
        password: zkPassword,
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
}