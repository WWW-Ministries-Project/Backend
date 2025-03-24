import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";

// Swagger definition
const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Program API",
      version: "1.0.0",
      description: "API documentation for managing programs and topics",
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Local server",
      },
    ],
  },
  apis: ["./routes/*.ts"], // Location of API routes
};

// Initialize Swagger
const swaggerSpec = swaggerJSDoc(options);

// Function to setup Swagger
export const setupSwagger = (app: Express) => {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
