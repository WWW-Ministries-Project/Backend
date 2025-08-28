import swaggerJSDoc from "swagger-jsdoc";

// Swagger definition
const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "World Wide Ministries API",
      version: "1.0.0",
      description: "API documentation for WWM application",
    },
    servers: [
      {
        url: "https://wwm-bk.supadealz.shop",
        description: "Online Development server",
      },
      {
        url: "http://localhost:8080",
        description: "Local Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter your JWT token in the format **Bearer &lt;token>**",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ["./src/modules/**/*.ts", "./dist/modules/**/*.js"],
};

module.exports = options;
